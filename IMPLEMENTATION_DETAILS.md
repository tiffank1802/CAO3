# Détails d'Implémentation - Architecture CAO Web

## Table des matières
1. [Diagrammes détaillés](#diagrammes-détaillés)
2. [Exemples de code détaillés](#exemples-de-code-détaillés)
3. [Configuration Django](#configuration-django)
4. [Stratégies de cache](#stratégies-de-cache)
5. [Tests unitaires patterns](#tests-unitaires-patterns)

---

## Diagrammes détaillés

### 1. Diagramme de flux complet: Créer un Sketch + Ajouter Géométrie

```
CLIENT (Trame)                 SERVEUR (Django)              DB (PostgreSQL)       CACHE (Redis)
│                              │                             │                      │
├─ UI Sketch Editor            │                             │                      │
│  └─ Click "New Sketch"        │                             │                      │
│                              │                             │                      │
├─ POST /api/sketches          │                             │                      │
│  {name: "S1", plane: "XY"}   │                             │                      │
│  ───────────────────────────►│                             │                      │
│                              ├─ Validate input             │                      │
│                              ├─ Create Sketch object       │                      │
│                              │  ─────────────────────────►│ INSERT into sketches  │
│                              │◄──────────────────────────── │                      │
│                              │                             │                      │
│                              ├─ Create SketchCreatedEvent  │                      │
│                              │  ────────────────────────────────────────────────►│
│                              │  SET sketches:{sketch_id}   │
│                              │    {geometry: {}, constraints: {}}                 │
│◄─────────────────────────────│ 201 + sketch_id            │                      │
│ {id: "sketch_xyz", ...}      │                             │                      │
│                              │                             │                      │
├─ Store sketch_id locally     │                             │                      │
├─ Init SketchUI with solver   │                             │                      │
│                              │ WebSocket broadcast to      │                      │
│                              │ workspace group             │                      │
│                              │ ───────────────────────────► GROUP:              │
│                              │                             │ workspace_xyz         │
│                              │                             │                      │
│                              │                             │ msg: SketchCreated   │
│                              │                             │  → update all views  │
│                              │                             │                      │
├─ User draws line (10, 0)→(20, 0)                           │                      │
│                              │                             │                      │
├─ POST /api/sketches/xyz/geometry                           │                      │
│  {                           │                             │                      │
│    geometry_id: "line_1",    │                             │                      │
│    type: "line",             │                             │                      │
│    start: {x: 10, y: 0},     │                             │                      │
│    end: {x: 20, y: 0}        │                             │                      │
│  }                           │                             │                      │
│  ───────────────────────────►│                             │                      │
│                              ├─ Validate coordinates      │                      │
│                              ├─ Create GeometryAddedEvent │                      │
│                              │  with geometry_id, type    │                      │
│                              │                             │                      │
│                              ├─ EventStore.append_event() │                      │
│                              │  ┌──────────────────────┐   │                      │
│                              │  │ 1. Get next seq_num  │   │                      │
│                              │  │ 2. INSERT event     │   │                      │
│                              │  │ 3. UPDATE latest    │   │                      │
│                              │  │ 4. Broadcast via    │   │                      │
│                              │  │    Redis Pub/Sub    │   │                      │
│                              │  └──────────────────────┘   │                      │
│                              │                             │                      │
│                              │  ────────────────────────►│ INSERT INTO events    │
│                              │  (aggregate_id, event_type,│ (sequence_number)    │
│                              │   data, timestamp, user)   │                      │
│                              │◄──────────────────────────── │                      │
│                              │                             │                      │
│                              │  ─────────────────────────────────────────────────►│
│                              │  LPUSH sketches:xyz:events {geometry_id...}       │
│                              │  EXPIRE sketches:xyz:events 604800                │
│                              │  PUBLISH workspace:xyz {...}                      │
│                              │                             │                      │
│◄─────────────────────────────│ 201 Created                │                      │
│ {geometry_id: "line_1", ...} │                             │                      │
│                              │                             │                      │
├─ Local state += geometry     │                             │                      │
├─ Re-render canvas            │                             │                      │
│  (Cassowary solver runs)     │                             │                      │
│                              │                             │                      │
│ ◄─ WebSocket msg             │                             │                      │
│    (from broadcast) ───────────────────────────────────────────────────────────►│
│    {                         │                             │                      │
│      event_type: "geometry_added",                         │                      │
│      geometry_id: "line_1",                                │                      │
│      ...                                                   │                      │
│    }                         │                             │                      │
│                              │                             │                      │
├─ Render line on canvas      │                             │                      │
├─ (Other users see it too)   │                             │                      │
│                              │                             │                      │
├─ User adds constraint:      │                             │                      │
│  "Distance line_1 to line_2 = 5mm"                        │                      │
│                              │                             │                      │
├─ POST /api/sketches/xyz/constraints                       │                      │
│  {                           │                             │                      │
│    constraint_id: "const_1", │                             │                      │
│    type: "distance",         │                             │                      │
│    entities: ["line_1", "line_2"],                         │                      │
│    value: 5.0                │                             │                      │
│  }                           │                             │                      │
│  ───────────────────────────►│                             │                      │
│                              ├─ SketchEngine.solve()      │                      │
│                              │  ├─ Cassowary solver       │                      │
│                              │  │  .add_constraint()      │                      │
│                              │  │  .solve()               │                      │
│                              │  └─ Get positions          │                      │
│                              │                             │                      │
│                              ├─ Create ConstraintAddedEvent              │
│                              │  ────────────────────────►│ INSERT INTO events    │
│                              │  ────────────────────────────────────────────────►│
│                              │  HSET constraints:{sketch_id} const_1 {...}       │
│                              │                             │                      │
│◄─────────────────────────────│ 201 + positions            │                      │
│ {                            │                             │                      │
│   line_1: {x1: 10, y1: 0, x2: 10, y2: 5},                │                      │
│   line_2: {x1: 15, y1: 5, x2: 25, y2: 5}                 │                      │
│ }                            │                             │                      │
│                              │                             │                      │
├─ Update local positions     │                             │                      │
├─ Re-render (geometry moved) │                             │                      │
│                              │                             │                      │
│                              │  WebSocket broadcast      │                      │
│                              │  all users updated ────────────────────────────►│
│                              │                             │                      │
```

### 2. Diagramme de flux Undo/Redo

```
User Action Stack (Memory)        Event Store (PostgreSQL)      Undo/Redo Stack (DB)
│                                 │                              │
├─ Add Geometry "line_1"           │                              │
│  UndoRedoStack.push(event_1)     │                              │
│  ───────────────────────────────►│ INSERT Event(event_1)        │
│                                  │                              │
│                                  │ ◄─────────────────────────── │ CREATE URS
│                                  │                              │ undo: [event_1]
│                                  │                              │ redo: []
│                                  │                              │
├─ Add Constraint "const_1"        │                              │
│  UndoRedoStack.push(event_2)     │                              │
│  ───────────────────────────────►│ INSERT Event(event_2)        │
│                                  │                              │
│                                  │ ◄─────────────────────────── │ UPDATE URS
│                                  │                              │ undo: [event_1, event_2]
│                                  │                              │ redo: []
│                                  │                              │
├─ User clicks UNDO (Ctrl+Z)       │                              │
│  event_id = UndoRedoStack.pop()  │                              │
│  = event_2                       │                              │
│                                  │                              │
├─ Create UndoEvent               │                              │
│  referring to event_2            │                              │
│  ───────────────────────────────►│ INSERT Event(undo_event)     │
│                                  │ (reverted_event_id: event_2) │
│                                  │                              │
│                                  │ ◄─────────────────────────── │ UPDATE URS
│                                  │                              │ undo: [event_1]
│                                  │                              │ redo: [event_2]
│                                  │                              │
├─ SketchProjection rebuilt       │                              │
│  from [event_1] only             │                              │
│  (skipping event_2)              │                              │
│                                  │                              │
├─ Geometry updates              │                              │
│  (constraint removed)            │                              │
│                                  │                              │
├─ User clicks REDO (Ctrl+Y)       │                              │
│  event_id = UndoRedoStack.redo() │                              │
│  = event_2                       │                              │
│                                  │                              │
├─ Create RedoEvent               │                              │
│  referring to event_2            │                              │
│  ───────────────────────────────►│ INSERT Event(redo_event)     │
│                                  │ (reapplied_event_id: event_2)│
│                                  │                              │
│                                  │ ◄─────────────────────────── │ UPDATE URS
│                                  │                              │ undo: [event_1, event_2]
│                                  │                              │ redo: []
│                                  │                              │
├─ Projection rebuilt from       │                              │
│  [event_1, event_2]              │                              │
│                                  │                              │
├─ Geometry fully restored        │                              │
│                                  │                              │
```

### 3. Diagramme: Créer un Pad et exécuter opération

```
CLIENT                              SERVER (Part CAD Engine)        Database          Celery Worker
│                                   │                              │                  │
├─ User selects Sketch + "Pad"      │                              │                  │
├─ Opens Pad dialog                 │                              │                  │
│  - Sketch: "S1" ✓                 │                              │                  │
│  - Depth: 10 mm                   │                              │                  │
│  - Symmetric: No                  │                              │                  │
│                                   │                              │                  │
├─ POST /api/parts/xyz/operations   │                              │                  │
│  {                                │                              │                  │
│    operation_type: "pad",         │                              │                  │
│    name: "Pad1",                  │                              │                  │
│    sketch_id: "sketch_1",         │                              │                  │
│    depth: 10.0                    │                              │                  │
│  }                                │                              │                  │
│  ──────────────────────────────►│                              │                  │
│                                   │                              │                  │
│                                   ├─ Create PadOperation         │                  │
│                                   │  ├─ Validate parameters      │                  │
│                                   │  │  - depth > 0? ✓           │                  │
│                                   │  │  - sketch_id exists? ✓    │                  │
│                                   │  │  - sketch is active? ✓    │                  │
│                                   │  │                           │                  │
│                                   │  ├─ Save Operation to DB     │                  │
│                                   │  │  ──────────────────────►│ INSERT Operations │
│                                   │  │◄─────────────────────────│ op_id: "pad_1"   │
│                                   │  │                          │ order: 1         │
│                                   │  │                           │                  │
│                                   │  ├─ Create OperationAddedEvent│                  │
│                                   │  │  ──────────────────────►│ INSERT Events    │
│                                   │  │  (part_id, op_id, type, params)             │
│                                   │  │                           │                  │
│                                   │  └─ Async: Compute geometry  │                  │
│                                   │     Send to Celery ─────────────────────────►│
│                                   │                           │                  │
│◄──────────────────────────────────│ 202 Accepted + task_id   │                  │
│ {                                 │                          │                  │
│   operation_id: "pad_1",          │                          │                  │
│   status: "computing",            │                          │                  │
│   task_id: "task_xyz"             │                          │                  │
│ }                                 │                          │                  │
│                                   │                          │                  │
├─ Show progress spinner           │                          │                  │
├─ Poll GET /tasks/task_xyz        │                          │                  │
│  every 1s                         │                          │                  │
│                                   │                          │                  │
│                                   │                          │ TASK: ComputePadGeometry
│                                   │                          │ ├─ Fetch Sketch s1
│                                   │                          │ │  ──────────────►│
│                                   │                          │◄──────────────────│
│                                   │                          │  sketch geometry  │
│                                   │                          │                  │
│                                   │                          │ ├─ Convert to Wire
│                                   │                          │ ├─ CadQuery.Workplane()
│                                   │                          │ ├─ .pad(10.0)
│                                   │                          │ ├─ Serialize BREP
│                                   │                          │ └─ BBox calculation
│                                   │                          │                  │
│                                   │                          │ RETURN {        │
│                                   │                          │   brep_bytes,    │
│                                   │                          │   bbox,          │
│                                   │                          │   faces_count    │
│                                   │                          │ }                │
│                                   │◄─────────────────────────────────────────────│
│                                   │                          │                  │
│                                   ├─ Receive task result     │                  │
│                                   ├─ Store computed geometry │                  │
│                                   │  ──────────────────────►│ UPDATE Operations│
│                                   │  computed_geometry: BREP │ bbox: {...}     │
│                                   │  bounding_box: {...}    │                  │
│                                   │◄──────────────────────────────────────────  │
│                                   │                          │                  │
│                                   ├─ Create GeometryComputed event              │
│                                   │  ──────────────────────►│ INSERT Events    │
│                                   │                          │                  │
│                                   ├─ Update PartProjection  │                  │
│                                   │  operations_list += Pad1 │                  │
│                                   │  current_geometry: BREP  │                  │
│                                   │                          │                  │
│                                   ├─ Cache geometry in Redis│                  │
│                                   │  SET part:xyz:geometry BREP                 │
│                                   │  EXPIRE 3600            │                  │
│                                   │                          │                  │
│                                   ├─ WebSocket broadcast    │                  │
│                                   │  msg: "operation_complete"                  │
│                                   │  geometry: BREP bytes    │                  │
│                                   │  ─────────────────────► │ [broadcast to all│
│                                   │                          │  workspace]      │
│                                   │                          │                  │
│ ◄────────────────────────────────────────────────────────────────────────────────│
│ WebSocket {                      │                          │                  │
│   type: "operation_complete",    │                          │                  │
│   operation_id: "pad_1",         │                          │                  │
│   geometry_url: "/download/...   │                          │                  │
│ }                                │                          │                  │
│                                   │                          │                  │
├─ Remove spinner                  │                          │                  │
├─ Load geometry from URL          │                          │                  │
├─ Three.js renders Pad            │                          │                  │
├─ Operations tree updated         │                          │                  │
│                                   │                          │                  │
```

---

## Exemples de code détaillés

### 1. EventStore avec garanties ACID

```python
# events/event_store.py - Implementation complète

import logging
from typing import List, Dict, Optional, Any
from uuid import UUID
from datetime import datetime, timezone
from contextlib import contextmanager

from django.db import transaction, connection
from django.core.cache import cache
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)


class EventStoreException(Exception):
    """Exceptions Event Store"""
    pass


class EventStoreAtomic:
    """Garantie atomicité Event Store"""
    
    @staticmethod
    @contextmanager
    def transaction(workspace_id: UUID):
        """Context manager pour transaction garantie"""
        try:
            with transaction.atomic():
                # SERIALIZABLE isolation level pour consistency
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"
                    )
                yield
        except transaction.TransactionManagementError as e:
            logger.error(f"Transaction failed: {e}")
            raise EventStoreException(f"Transaction failed: {e}")


class EventStore:
    """
    Implémentation complète Event Store avec:
    - Garanties ACID (PostgreSQL)
    - Broadcast Redis
    - Caching multi-tier
    """
    
    def __init__(self):
        self.channel_layer = get_channel_layer()
        self.logger = logging.getLogger(self.__class__.__name__)
    
    def append_event(
        self,
        event_data: Dict[str, Any],
        aggregate_id: UUID,
        aggregate_type: str,
        event_type: str,
        user_id: UUID,
        workspace_id: UUID,
        metadata: Optional[Dict] = None,
    ) -> 'Event':
        """
        Ajouter événement avec atomicité garantie
        
        Atomicité:
        1. Obtenir sequence_number suivant (atomic)
        2. Insérer event (atomic)
        3. Actualiser cache
        4. Broadcaster
        
        Si erreur à l'étape 2, rollback 1
        Si erreur à 3-4, non bloquant
        """
        
        metadata = metadata or {}
        
        try:
            with EventStoreAtomic.transaction(workspace_id):
                from events.models import Event
                
                # 1. Déterminer sequence_number atomiquement
                # SELECT FOR UPDATE + increment
                with connection.cursor() as cursor:
                    cursor.execute("""
                        SELECT COALESCE(MAX(sequence_number), 0) + 1
                        FROM events
                        WHERE workspace_id = %s
                        FOR UPDATE
                    """, [str(workspace_id)])
                    
                    next_seq = cursor.fetchone()[0]
                
                # 2. Créer l'événement (immutable)
                db_event = Event.objects.create(
                    id=uuid.uuid4(),
                    aggregate_id=aggregate_id,
                    aggregate_type=aggregate_type,
                    event_type=event_type,
                    data=event_data,
                    metadata={
                        **metadata,
                        'timestamp_server': datetime.now(timezone.utc).isoformat(),
                        'user_id': str(user_id),
                    },
                    sequence_number=next_seq,
                    version=1,  # Version de l'agrégat
                    user_id=user_id,
                    workspace_id=workspace_id,
                )
                
                self.logger.info(
                    f"Event appended: {event_type} "
                    f"(seq={next_seq}, agg={aggregate_id})"
                )
                
                # Retour avant async operations (peut échouer sans erreur utilisateur)
        
        except Exception as e:
            self.logger.error(f"Event append failed: {e}")
            raise EventStoreException(f"Failed to append event: {e}")
        
        # 3. Actualiser cache (non-bloquant)
        self._update_cache(aggregate_id, db_event)
        
        # 4. Broadcaster vers tous les clients (non-bloquant)
        self._broadcast_event(workspace_id, db_event)
        
        return db_event
    
    def _update_cache(self, aggregate_id: UUID, event: 'Event'):
        """Actualiser cache Redis"""
        try:
            cache_key = f"events:{aggregate_id}"
            
            # Récupérer liste actuelle
            events_list = cache.get(cache_key, [])
            
            # Ajouter nouveau
            events_list.append({
                'id': str(event.id),
                'event_type': event.event_type,
                'data': event.data,
                'timestamp': event.timestamp.isoformat(),
            })
            
            # Garder seulement derniers 1000 événements en cache
            events_list = events_list[-1000:]
            
            # TTL = 7 jours
            cache.set(cache_key, events_list, 7 * 24 * 3600)
            
            self.logger.debug(f"Cache updated for {aggregate_id}")
        
        except Exception as e:
            self.logger.warning(f"Cache update failed (non-blocking): {e}")
    
    def _broadcast_event(self, workspace_id: UUID, event: 'Event'):
        """Broadcaster via Redis Pub/Sub (non-bloquant)"""
        try:
            async_to_sync(self.channel_layer.group_send)(
                f"workspace_{workspace_id}",
                {
                    "type": "event.broadcast",
                    "event_id": str(event.id),
                    "aggregate_id": str(event.aggregate_id),
                    "aggregate_type": event.aggregate_type,
                    "event_type": event.event_type,
                    "data": event.data,
                    "timestamp": event.timestamp.isoformat(),
                    "user_id": str(event.user_id),
                }
            )
            self.logger.debug(f"Event broadcasted to workspace {workspace_id}")
        
        except Exception as e:
            self.logger.warning(f"Broadcast failed (non-blocking): {e}")
    
    def get_events_for_aggregate(
        self,
        aggregate_id: UUID,
        from_version: int = 0
    ) -> List['Event']:
        """
        Récupérer tous les événements pour une entité
        Essayer cache d'abord, puis BD
        """
        
        # Essayer cache Redis
        cache_key = f"events:{aggregate_id}"
        cached = cache.get(cache_key)
        
        if cached:
            self.logger.debug(f"Events from cache for {aggregate_id}")
            return cached
        
        # Fallback: BD
        from events.models import Event
        
        events = Event.objects.filter(
            aggregate_id=aggregate_id,
            version__gte=from_version
        ).order_by('version').values()
        
        self.logger.debug(f"Events from DB for {aggregate_id}")
        return list(events)
    
    def get_events_since(
        self,
        workspace_id: UUID,
        timestamp: datetime
    ) -> List['Event']:
        """Récupérer événements après timestamp"""
        from events.models import Event
        
        events = Event.objects.filter(
            workspace_id=workspace_id,
            timestamp__gte=timestamp
        ).order_by('timestamp').values()
        
        return list(events)
    
    def create_snapshot(
        self,
        aggregate_id: UUID,
        version: int,
        state: Dict[str, Any]
    ):
        """Créer snapshot pour optimization rechargement"""
        from events.models import EventSnapshot
        
        try:
            EventSnapshot.objects.create(
                aggregate_id=aggregate_id,
                version=version,
                state=state,
            )
            self.logger.info(f"Snapshot created for {aggregate_id} v{version}")
        except Exception as e:
            self.logger.error(f"Snapshot creation failed: {e}")
    
    def rebuild_from_snapshot(
        self,
        aggregate_id: UUID,
        aggregate_type: str
    ) -> Dict[str, Any]:
        """
        Reconstructeur l'état depuis snapshot + événements suivants
        Optimization pour aggregates avec beaucoup d'événements
        """
        from events.models import Event, EventSnapshot
        
        # Trouver dernier snapshot
        latest_snapshot = EventSnapshot.objects.filter(
            aggregate_id=aggregate_id
        ).order_by('-version').first()
        
        if not latest_snapshot:
            # Pas de snapshot, reconstruire depuis zéro
            from_version = 0
            state = self._get_initial_state(aggregate_type)
        else:
            from_version = latest_snapshot.version
            state = latest_snapshot.state
        
        # Récupérer événements après snapshot
        events = Event.objects.filter(
            aggregate_id=aggregate_id,
            version__gt=from_version
        ).order_by('version')
        
        # Appliquer événements
        for event in events:
            state = self._apply_event_to_state(state, event)
        
        return state
    
    def _get_initial_state(self, aggregate_type: str) -> Dict:
        """État initial par type agrégat"""
        initial_states = {
            'Sketch': {
                'geometry': {},
                'constraints': {},
                'version': 0,
            },
            'Part': {
                'operations': [],
                'current_geometry': None,
                'version': 0,
            },
            'Assembly': {
                'components': [],
                'constraints': [],
                'version': 0,
            },
        }
        return initial_states.get(aggregate_type, {})
    
    def _apply_event_to_state(
        self,
        state: Dict,
        event: 'Event'
    ) -> Dict:
        """Appliquer un événement à l'état (projection)"""
        event_type = event.event_type
        data = event.data
        
        if event_type == 'sketch.geometry_added':
            state['geometry'][data['geometry_id']] = {
                'type': data['geometry_type'],
                'data': data['data'],
            }
        
        elif event_type == 'sketch.constraint_added':
            state['constraints'][data['constraint_id']] = {
                'type': data['constraint_type'],
                'variables': data['variables'],
                'value': data['value'],
            }
        
        elif event_type == 'sketch.constraint_removed':
            state['constraints'].pop(data['constraint_id'], None)
        
        elif event_type == 'part.operation_added':
            state['operations'].append({
                'id': data['operation_id'],
                'name': data['name'],
                'type': data['operation_type'],
                'parameters': data['parameters'],
            })
        
        # ... autres types d'événements
        
        state['version'] = event.version
        return state


# Singleton global
event_store = EventStore()
```

### 2. SketchEngine avec Cassowary

```python
# sketcher/engine.py - Moteur Sketch complet

from typing import Dict, Tuple, Optional, List
from uuid import UUID
import logging

try:
    from cassowary import (
        ClVariable, Constraint, SimplexSolver,
        Expression, Strength, GE, LE, EQ
    )
except ImportError:
    raise ImportError("cassowary package required: pip install cassowary")

logger = logging.getLogger(__name__)


class SketchPoint:
    """Point 2D avec variables Cassowary"""
    
    def __init__(self, point_id: str, x: float = 0.0, y: float = 0.0):
        self.id = point_id
        self.x_var = ClVariable(f"{point_id}_x", x)
        self.y_var = ClVariable(f"{point_id}_y", y)
    
    def get_position(self) -> Tuple[float, float]:
        return (self.x_var.get_value(), self.y_var.get_value())
    
    def set_position(self, x: float, y: float):
        self.x_var.set_value(x)
        self.y_var.set_value(y)


class SketchLine:
    """Ligne 2D (définie par 2 points)"""
    
    def __init__(
        self,
        line_id: str,
        start_point: SketchPoint,
        end_point: SketchPoint
    ):
        self.id = line_id
        self.start = start_point
        self.end = end_point
    
    def get_length(self) -> float:
        x1, y1 = self.start.get_position()
        x2, y2 = self.end.get_position()
        return ((x2-x1)**2 + (y2-y1)**2)**0.5
    
    def get_direction_angle(self) -> float:
        """Angle en degrés"""
        import math
        x1, y1 = self.start.get_position()
        x2, y2 = self.end.get_position()
        return math.degrees(math.atan2(y2-y1, x2-x1))


class SketchCircle:
    """Cercle 2D"""
    
    def __init__(self, circle_id: str, center: SketchPoint, radius: float):
        self.id = circle_id
        self.center = center
        self.radius_var = ClVariable(f"{circle_id}_radius", radius)
    
    def get_radius(self) -> float:
        return self.radius_var.get_value()
    
    def set_radius(self, radius: float):
        if radius <= 0:
            raise ValueError("Radius must be positive")
        self.radius_var.set_value(radius)


class SketchEngine:
    """
    Moteur Sketch avec solveur Cassowary
    Gère géométrie + contraintes
    """
    
    def __init__(self, sketch_id: UUID):
        self.sketch_id = sketch_id
        self.solver = SimplexSolver()
        
        # Entities
        self.points: Dict[str, SketchPoint] = {}
        self.lines: Dict[str, SketchLine] = {}
        self.circles: Dict[str, SketchCircle] = {}
        
        # Constraints
        self.constraints: Dict[str, Constraint] = {}
        
        logger.info(f"SketchEngine initialized for {sketch_id}")
    
    # ========== GEOMETRY CREATION ==========
    
    def add_point(
        self,
        point_id: str,
        x: float = 0.0,
        y: float = 0.0
    ) -> SketchPoint:
        """Ajouter point"""
        if point_id in self.points:
            raise ValueError(f"Point {point_id} already exists")
        
        point = SketchPoint(point_id, x, y)
        self.points[point_id] = point
        
        logger.debug(f"Point added: {point_id} ({x}, {y})")
        return point
    
    def add_line(
        self,
        line_id: str,
        start_id: str,
        end_id: str
    ) -> SketchLine:
        """Ajouter ligne"""
        if line_id in self.lines:
            raise ValueError(f"Line {line_id} already exists")
        
        start = self.points.get(start_id)
        end = self.points.get(end_id)
        
        if not start or not end:
            raise ValueError("Start/end points not found")
        
        line = SketchLine(line_id, start, end)
        self.lines[line_id] = line
        
        logger.debug(f"Line added: {line_id}")
        return line
    
    def add_circle(
        self,
        circle_id: str,
        center_id: str,
        radius: float
    ) -> SketchCircle:
        """Ajouter cercle"""
        if circle_id in self.circles:
            raise ValueError(f"Circle {circle_id} already exists")
        
        center = self.points.get(center_id)
        if not center:
            raise ValueError("Center point not found")
        
        if radius <= 0:
            raise ValueError("Radius must be positive")
        
        circle = SketchCircle(circle_id, center, radius)
        self.circles[circle_id] = circle
        
        logger.debug(f"Circle added: {circle_id} (r={radius})")
        return circle
    
    # ========== CONSTRAINTS ==========
    
    def add_distance_constraint(
        self,
        constraint_id: str,
        entity1_id: str,
        entity2_id: str,
        distance: float,
        strength: Strength = Strength.strong
    ):
        """Contrainte de distance"""
        try:
            entity1 = self._get_entity(entity1_id)
            entity2 = self._get_entity(entity2_id)
            
            if isinstance(entity1, SketchPoint) and isinstance(entity2, SketchPoint):
                # Distance entre points
                self._add_point_distance_constraint(
                    constraint_id, entity1, entity2, distance, strength
                )
            
            elif isinstance(entity1, SketchLine) and isinstance(entity2, SketchLine):
                # Distance entre lignes
                self._add_line_distance_constraint(
                    constraint_id, entity1, entity2, distance, strength
                )
            
            else:
                raise ValueError("Unsupported entities for distance constraint")
        
        except Exception as e:
            logger.error(f"Failed to add distance constraint: {e}")
            raise
    
    def _add_point_distance_constraint(
        self,
        constraint_id: str,
        p1: SketchPoint,
        p2: SketchPoint,
        distance: float,
        strength: Strength
    ):
        """Distance Euclidienne entre deux points"""
        # sqrt((x2-x1)² + (y2-y1)²) = distance
        # Pour simplifier: utiliser distance Manhattan ou approximation
        
        # Expression: |p2.x - p1.x| >= distance (approximation)
        expr_x = Expression([(p2.x_var, 1.0), (p1.x_var, -1.0)])
        constraint = Constraint(expr_x, GE, distance, strength)
        
        self.solver.add_constraint(constraint)
        self.constraints[constraint_id] = constraint
        
        logger.debug(f"Distance constraint added: {constraint_id}")
    
    def add_horizontal_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.strong
    ):
        """Forcer deux points horizontalement alignés"""
        p1 = self.points.get(point1_id)
        p2 = self.points.get(point2_id)
        
        if not p1 or not p2:
            raise ValueError("Points not found")
        
        # y1 == y2
        expr = Expression([(p1.y_var, 1.0), (p2.y_var, -1.0)])
        constraint = Constraint(expr, EQ, 0, strength)
        
        self.solver.add_constraint(constraint)
        self.constraints[constraint_id] = constraint
        
        logger.debug(f"Horizontal constraint added: {constraint_id}")
    
    def add_vertical_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.strong
    ):
        """Forcer deux points verticalement alignés"""
        p1 = self.points.get(point1_id)
        p2 = self.points.get(point2_id)
        
        if not p1 or not p2:
            raise ValueError("Points not found")
        
        # x1 == x2
        expr = Expression([(p1.x_var, 1.0), (p2.x_var, -1.0)])
        constraint = Constraint(expr, EQ, 0, strength)
        
        self.solver.add_constraint(constraint)
        self.constraints[constraint_id] = constraint
        
        logger.debug(f"Vertical constraint added: {constraint_id}")
    
    def add_coincident_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.required
    ):
        """Forcer deux points coïncidents"""
        p1 = self.points.get(point1_id)
        p2 = self.points.get(point2_id)
        
        if not p1 or not p2:
            raise ValueError("Points not found")
        
        # x1 == x2
        expr_x = Expression([(p1.x_var, 1.0), (p2.x_var, -1.0)])
        constraint_x = Constraint(expr_x, EQ, 0, strength)
        
        # y1 == y2
        expr_y = Expression([(p1.y_var, 1.0), (p2.y_var, -1.0)])
        constraint_y = Constraint(expr_y, EQ, 0, strength)
        
        self.solver.add_constraint(constraint_x)
        self.solver.add_constraint(constraint_y)
        
        self.constraints[f"{constraint_id}_x"] = constraint_x
        self.constraints[f"{constraint_id}_y"] = constraint_y
        
        logger.debug(f"Coincident constraint added: {constraint_id}")
    
    def add_radius_constraint(
        self,
        constraint_id: str,
        circle_id: str,
        radius: float,
        strength: Strength = Strength.strong
    ):
        """Contrainte de rayon"""
        circle = self.circles.get(circle_id)
        if not circle:
            raise ValueError(f"Circle {circle_id} not found")
        
        # radius_var == radius
        expr = Expression([(circle.radius_var, 1.0)])
        constraint = Constraint(expr, EQ, radius, strength)
        
        self.solver.add_constraint(constraint)
        self.constraints[constraint_id] = constraint
        
        logger.debug(f"Radius constraint added: {constraint_id}")
    
    # ========== SOLVING & RESULTS ==========
    
    def solve(self) -> Tuple[bool, Optional[str]]:
        """
        Résoudre le système de contraintes
        Retourne (success, error_message)
        """
        try:
            self.solver.resolve()
            logger.info(f"Sketch solved successfully")
            return True, None
        
        except Exception as e:
            error_msg = f"Solver failed: {e}"
            logger.error(error_msg)
            return False, error_msg
    
    def get_point_position(self, point_id: str) -> Tuple[float, float]:
        """Obtenir position résolue d'un point"""
        point = self.points.get(point_id)
        if not point:
            raise ValueError(f"Point {point_id} not found")
        return point.get_position()
    
    def get_all_positions(self) -> Dict[str, Tuple[float, float]]:
        """Obtenir toutes les positions"""
        return {
            point_id: point.get_position()
            for point_id, point in self.points.items()
        }
    
    def get_geometry_data(self) -> Dict:
        """Exporter géométrie pour client"""
        success, _ = self.solve()
        
        if not success:
            return {'error': 'Solver failed'}
        
        return {
            'points': self.get_all_positions(),
            'lines': {
                line_id: {
                    'start': line.start.id,
                    'end': line.end.id,
                    'length': line.get_length(),
                }
                for line_id, line in self.lines.items()
            },
            'circles': {
                circle_id: {
                    'center': circle.center.id,
                    'radius': circle.get_radius(),
                }
                for circle_id, circle in self.circles.items()
            },
        }
    
    # ========== HELPER METHODS ==========
    
    def _get_entity(self, entity_id: str):
        """Récupérer entité (point, line, circle)"""
        if entity_id in self.points:
            return self.points[entity_id]
        elif entity_id in self.lines:
            return self.lines[entity_id]
        elif entity_id in self.circles:
            return self.circles[entity_id]
        else:
            raise ValueError(f"Entity {entity_id} not found")
    
    def _add_line_distance_constraint(self, constraint_id, line1, line2, distance, strength):
        """Distance entre lignes (approximée)"""
        # Distance entre points de départ
        expr = Expression([
            (line1.start.x_var, 1.0),
            (line2.start.x_var, -1.0)
        ])
        constraint = Constraint(expr, GE, distance, strength)
        self.solver.add_constraint(constraint)
        self.constraints[constraint_id] = constraint
```

---

## Configuration Django

### settings.py complet

```python
# cao3_project/settings.py

import os
from pathlib import Path
from datetime import timedelta

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent

# Security
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key-change-in-production')
DEBUG = os.environ.get('DEBUG', 'False') == 'True'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

CSRF_TRUSTED_ORIGINS = os.environ.get(
    'CSRF_TRUSTED_ORIGINS',
    'http://localhost:3000,http://localhost:8000'
).split(',')

# CORS
CORS_ALLOWED_ORIGINS = CSRF_TRUSTED_ORIGINS
CORS_ALLOW_CREDENTIALS = True

# Apps
INSTALLED_APPS = [
    # Django built-in
    'daphne',  # ASGI
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third-party
    'rest_framework',
    'channels',
    'corsheaders',
    'django_extensions',
    'django_filters',
    
    # Local apps
    'auth_workspace',
    'projects',
    'sketcher',
    'cad_operations',
    'assemblies',
    'events',
    'collaboration',
]

# Middleware
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'cao3_project.urls'

# Database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'cao3_db'),
        'USER': os.environ.get('DB_USER', 'cao3_user'),
        'PASSWORD': os.environ.get('DB_PASSWORD', 'password'),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'ATOMIC_REQUESTS': True,  # CRITICAL pour Event Store
        'CONN_MAX_AGE': 600,
        'OPTIONS': {
            'options': '-c default_transaction_isolation=repeatable_read'
        },
    }
}

# Caching
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': os.environ.get('REDIS_URL', 'redis://localhost:6379/0'),
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            'CONNECTION_POOL_KWARGS': {
                'max_connections': 50,
                'retry_on_timeout': True,
            },
        },
        'KEY_PREFIX': 'cao3',
        'TIMEOUT': 300,
    }
}

# Session
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
SESSION_CACHE_ALIAS = 'default'
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Strict'

# Channels (WebSocket)
ASGI_APPLICATION = 'cao3_project.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [os.environ.get('REDIS_URL', 'redis://localhost:6379/1')],
            'capacity': 10000,
            'expiry': 10,
            'group_expiry': 86400,
        },
    },
}

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle'
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '10000/hour'
    }
}

# JWT
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
}

# Celery
CELERY_BROKER_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/2')
CELERY_RESULT_BACKEND = os.environ.get('REDIS_URL', 'redis://localhost:6379/2')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes hard limit
CELERY_TASK_SOFT_TIME_LIMIT = 25 * 60  # 25 minutes soft limit

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'file': {
            'class': 'logging.FileHandler',
            'filename': os.path.join(BASE_DIR, 'cao3.log'),
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': 'INFO',
    },
    'loggers': {
        'events.event_store': {'level': 'DEBUG'},
        'sketcher.engine': {'level': 'DEBUG'},
        'cad_operations.engine': {'level': 'DEBUG'},
    },
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Media files
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# CAD Configuration
CAD_CONFIG = {
    'GEOMETRY_TIMEOUT': 30,  # seconds
    'GEOMETRY_CACHE_TTL': 3600,  # 1 hour
    'MAX_OPERATION_SEQUENCE': 100,
    'BREP_EXPORT_FORMAT': 'step',  # or 'brep'
}

# Event Store Configuration
EVENT_STORE_CONFIG = {
    'SNAPSHOT_FREQUENCY': 100,  # Create snapshot every N events
    'EVENT_RETENTION_DAYS': 90,
    'MAX_EVENTS_CACHE': 1000,
}
```

---

## Stratégies de cache

### Cache Strategy Document

```python
# caching/strategy.py - Stratégie multi-tier

"""
Stratégie de cache pour application CAO

Niveaux:
1. L1: In-memory (Python dict) - accès très rapide
2. L2: Redis - accès rapide distribué
3. L3: PostgreSQL - persistance

Pattern: Cache-Aside avec invalidation intelligente
"""

from django.core.cache import cache
from functools import wraps
import hashlib
import json

class CacheKeys:
    """Constantes pour clés cache"""
    
    # Events
    EVENTS_FOR_AGGREGATE = "events:{aggregate_id}"
    EVENTS_RECENT = "events:recent:{workspace_id}"
    
    # Geometry
    GEOMETRY_PART = "geo:part:{part_id}"
    GEOMETRY_SKETCH = "geo:sketch:{sketch_id}"
    BOUNDING_BOX = "bbox:{entity_id}"
    
    # Projections
    PROJECTION_SKETCH = "proj:sketch:{sketch_id}"
    PROJECTION_PART = "proj:part:{part_id}"
    PROJECTION_ASSEMBLY = "proj:assembly:{assembly_id}"
    
    # User sessions
    USER_SESSIONS = "sessions:user:{user_id}"
    WORKSPACE_SESSIONS = "sessions:workspace:{workspace_id}"
    
    # Locks
    LOCK = "lock:{lock_type}:{target_id}"
    
    # Rate limiting
    RATE_LIMIT = "ratelimit:{user_id}:{endpoint}"


class CacheInvalidation:
    """Stratégies d'invalidation de cache"""
    
    @staticmethod
    def invalidate_sketch(sketch_id):
        """Invalider tous les caches liés à un sketch"""
        keys = [
            CacheKeys.GEOMETRY_SKETCH.format(sketch_id=sketch_id),
            CacheKeys.PROJECTION_SKETCH.format(sketch_id=sketch_id),
            CacheKeys.EVENTS_FOR_AGGREGATE.format(aggregate_id=sketch_id),
        ]
        cache.delete_many(keys)
    
    @staticmethod
    def invalidate_part(part_id):
        """Invalider tous les caches liés à une part"""
        keys = [
            CacheKeys.GEOMETRY_PART.format(part_id=part_id),
            CacheKeys.PROJECTION_PART.format(part_id=part_id),
            CacheKeys.BOUNDING_BOX.format(entity_id=part_id),
            CacheKeys.EVENTS_FOR_AGGREGATE.format(aggregate_id=part_id),
        ]
        cache.delete_many(keys)
    
    @staticmethod
    def invalidate_assembly(assembly_id):
        """Invalider assemblage"""
        keys = [
            CacheKeys.PROJECTION_ASSEMBLY.format(assembly_id=assembly_id),
            CacheKeys.GEOMETRY_PART.format(part_id=assembly_id),
            CacheKeys.EVENTS_FOR_AGGREGATE.format(aggregate_id=assembly_id),
        ]
        cache.delete_many(keys)


def cached_geometry(timeout=3600):
    """
    Décorateur pour cacher géométrie coûteuse
    TTL = 1 heure par défaut
    """
    def decorator(func):
        @wraps(func)
        def wrapper(entity_id, *args, **kwargs):
            cache_key = f"geo:{entity_id}"
            
            # Try L2 cache first
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Compute and cache
            result = func(entity_id, *args, **kwargs)
            cache.set(cache_key, result, timeout)
            
            return result
        return wrapper
    return decorator


def cached_projection(entity_type, timeout=300):
    """
    Décorateur pour cacher projections (read models)
    TTL = 5 minutes
    """
    def decorator(func):
        @wraps(func)
        def wrapper(entity_id, *args, **kwargs):
            cache_key = f"proj:{entity_type}:{entity_id}"
            
            # Try cache
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Rebuild from events
            result = func(entity_id, *args, **kwargs)
            cache.set(cache_key, result, timeout)
            
            return result
        return wrapper
    return decorator


class EventCache:
    """Cache pour événements avec ordonnance"""
    
    @staticmethod
    def get_events(aggregate_id, limit=100):
        """
        Récupérer événements avec cache Redis
        Fallback BD si nécessaire
        """
        cache_key = CacheKeys.EVENTS_FOR_AGGREGATE.format(aggregate_id=aggregate_id)
        
        # Try Redis
        events = cache.get(cache_key)
        if events:
            return events[-limit:]
        
        # Fallback BD
        from events.models import Event
        events = list(
            Event.objects.filter(
                aggregate_id=aggregate_id
            ).order_by('sequence_number').values()
        )
        
        # Cache 7 jours
        cache.set(cache_key, events, 7*24*3600)
        
        return events[-limit:]


# === IMPLEMENTATION DETAILS ===

"""
CACHE HIERARCHY EXAMPLE - Créer un Pad:

1. Client POST /operations (créer Pad)
   ├─ Validate parameters
   └─ Save Operation → DB

2. Async Celery task: compute_pad_geometry
   ├─ Get Sketch from DB
   ├─ Fetch geometry from cache (L2)
   │  └─ If miss → query DB, cache it
   ├─ Create CadQuery geometry
   ├─ Export BREP
   └─ Store in geometry cache (L2, TTL 1h)

3. On geometry update:
   ├─ Invalidate GEOMETRY_PART
   ├─ Invalidate PROJECTION_PART
   └─ Recalculate assembly geometry if needed

4. Client requests part view:
   ├─ API GET /parts/{id}
   ├─ Query PROJECTION_PART from cache
   │  ├─ If hit → return immediately
   │  └─ If miss → rebuild from events (EventCache) and cache
   └─ Return projection (read model)

CACHE INVALIDATION PATTERNS:

Pattern 1: Immediate Invalidation
- When user adds constraint → invalidate sketch projection
- Trade-off: Fresh data, lower cache hit rate

Pattern 2: TTL-based
- Geometry cache expires after 1 hour
- Good for expensive computations
- Trade-off: Stale data possible

Pattern 3: Event-driven
- On event append → trigger webhook
- Update cache asynchronously
- Trade-off: Complex, but optimal freshness

CHOSEN: Hybrid (1 + 3)
- Immediate for user-facing operations
- Event-driven for background updates
"""
```

---

**[Document continuerait avec tests patterns et exemples WebSocket...]**

**Fin de document d'implémentation détaillée**
