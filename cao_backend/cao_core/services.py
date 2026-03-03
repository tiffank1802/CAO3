"""
Event Store Service - Implements CQRS + Event Sourcing pattern
Handles event persistence and replay for undo/redo
"""
from django.db import transaction, IntegrityError
from django.utils import timezone
from django.contrib.auth.models import User
import uuid
from typing import Dict, Any, List, Optional
from cao_core.models import EventStore, Snapshot, Project, OperationHistory
import logging

logger = logging.getLogger(__name__)


class EventStoreService:
    """
    Central service for event sourcing operations
    Guarantees ACID compliance and consistent ordering
    """
    
    @staticmethod
    @transaction.atomic
    def append_event(
        project: Project,
        event_type: str,
        aggregate_id: uuid.UUID,
        aggregate_type: str,
        payload: Dict[str, Any],
        actor: Optional[User] = None
    ) -> EventStore:
        """
        Append an event to the event store (atomic operation)
        
        Args:
            project: Project instance
            event_type: Type of event (e.g., 'sketch_created', 'geometry_extruded')
            aggregate_id: ID of affected entity
            aggregate_type: Type of aggregate ('sketch', 'geometry', 'assembly')
            payload: Event data (parameters, old state, new state, etc)
            actor: User who triggered event
            
        Returns:
            EventStore instance created
            
        Raises:
            IntegrityError: If event sequence is violated
        """
        # Get next event number (ensure strict ordering)
        last_event = EventStore.objects.filter(project=project).last()
        event_number = (last_event.event_number + 1) if last_event else 1
        
        try:
            event = EventStore.objects.create(
                project=project,
                event_type=event_type,
                event_number=event_number,
                actor=actor,
                payload=payload,
                aggregate_id=aggregate_id,
                aggregate_type=aggregate_type,
                is_reverted=False
            )
            logger.info(f"Event appended: #{event_number} {event_type} on {aggregate_type} ({aggregate_id})")
            return event
        except IntegrityError as e:
            logger.error(f"Integrity error appending event: {e}")
            raise
    
    @staticmethod
    def get_aggregate_events(
        project: Project,
        aggregate_id: uuid.UUID,
        up_to_event_number: Optional[int] = None
    ) -> List[EventStore]:
        """
        Get all events for an aggregate (for replay)
        """
        query = EventStore.objects.filter(
            project=project,
            aggregate_id=aggregate_id,
            is_reverted=False  # Skip reverted events
        )
        
        if up_to_event_number:
            query = query.filter(event_number__lte=up_to_event_number)
        
        return list(query.order_by('event_number'))
    
    @staticmethod
    @transaction.atomic
    def revert_event(event: EventStore) -> None:
        """
        Mark event as reverted (soft delete for audit trail)
        """
        event.is_reverted = True
        event.reverted_at = timezone.now()
        event.save()
        logger.info(f"Event #{event.event_number} marked as reverted")
    
    @staticmethod
    def create_snapshot(
        project: Project,
        aggregate_id: uuid.UUID,
        aggregate_type: str,
        event_number: int,
        state: Dict[str, Any]
    ) -> Snapshot:
        """
        Create a snapshot for performance optimization
        Prevents need to replay all events from beginning
        """
        snapshot = Snapshot.objects.create(
            project=project,
            aggregate_id=aggregate_id,
            aggregate_type=aggregate_type,
            event_number=event_number,
            state=state
        )
        logger.info(f"Snapshot created for {aggregate_type} at event #{event_number}")
        return snapshot
    
    @staticmethod
    def get_latest_snapshot(
        project: Project,
        aggregate_id: uuid.UUID
    ) -> Optional[Snapshot]:
        """
        Get the most recent snapshot for an aggregate
        """
        return Snapshot.objects.filter(
            project=project,
            aggregate_id=aggregate_id
        ).order_by('-event_number').first()
    
    @staticmethod
    @transaction.atomic
    def undo_operation(project: Project, undo_index: int) -> bool:
        """
        Undo operation at specified index
        
        Args:
            project: Project instance
            undo_index: Index in operation history
            
        Returns:
            Success status
        """
        try:
            operation = OperationHistory.objects.get(
                project=project,
                undo_index=undo_index
            )
            
            # Mark events as reverted
            events = EventStore.objects.filter(
                event_number__gte=operation.first_event.event_number,
                event_number__lte=(operation.last_event.event_number if operation.last_event else operation.first_event.event_number),
                project=project
            )
            
            for event in events:
                EventStoreService.revert_event(event)
            
            logger.info(f"Undo executed for operation at index {undo_index}")
            return True
        except OperationHistory.DoesNotExist:
            logger.error(f"Operation at index {undo_index} not found")
            return False
    
    @staticmethod
    @transaction.atomic
    def redo_operation(project: Project, redo_index: int) -> bool:
        """
        Redo operation at specified index
        """
        try:
            operation = OperationHistory.objects.get(
                project=project,
                undo_index=redo_index
            )
            
            # Unmark events as reverted
            events = EventStore.objects.filter(
                event_number__gte=operation.first_event.event_number,
                event_number__lte=(operation.last_event.event_number if operation.last_event else operation.first_event.event_number),
                project=project
            )
            
            for event in events:
                event.is_reverted = False
                event.reverted_at = None
                event.save()
            
            logger.info(f"Redo executed for operation at index {redo_index}")
            return True
        except OperationHistory.DoesNotExist:
            logger.error(f"Operation at index {redo_index} not found")
            return False
    
    @staticmethod
    def get_operation_history(project: Project) -> List[OperationHistory]:
        """
        Get undo/redo stack for project
        """
        return list(
            OperationHistory.objects.filter(project=project).order_by('-undo_index')
        )
