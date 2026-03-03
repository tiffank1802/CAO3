"""
Core models for CAO application
Implements Event Sourcing with PostgreSQL
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import json
import uuid
from typing import Any, Dict, List, Optional


class Project(models.Model):
    """
    Root container for a CAO design project
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='cao_projects')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        db_table = 'cao_projects'
        indexes = [
            models.Index(fields=['owner', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.name} (Owner: {self.owner.username})"


class EventStore(models.Model):
    """
    Event Sourcing model: immutable log of all operations on a project
    Guarantees ACID compliance for undo/redo
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='events')
    
    # Event metadata
    event_type = models.CharField(max_length=100)  # e.g., 'sketch_created', 'geometry_extruded'
    event_number = models.BigIntegerField()  # Sequence number for ordering
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    # Event payload (stored as JSON)
    payload = models.JSONField(default=dict)
    
    # Metadata
    aggregate_id = models.UUIDField(db_index=True)  # ID of affected entity (Sketch, Geometry, etc)
    aggregate_type = models.CharField(max_length=50)  # Type: 'sketch', 'geometry', 'assembly'
    
    # Undo/Redo tracking
    is_reverted = models.BooleanField(default=False)  # Mark if event was undone
    reverted_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'cao_event_store'
        ordering = ['event_number']
        indexes = [
            models.Index(fields=['project', 'event_number']),
            models.Index(fields=['aggregate_id', 'aggregate_type']),
            models.Index(fields=['timestamp']),
        ]
        unique_together = [('project', 'event_number')]  # Ensure sequence integrity
    
    def __str__(self):
        return f"Event #{self.event_number}: {self.event_type} on {self.aggregate_type}"


class Snapshot(models.Model):
    """
    Performance optimization: cache aggregate state at specific event numbers
    Prevents need to replay all events from beginning
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='snapshots')
    
    # Reference to the aggregate
    aggregate_id = models.UUIDField(db_index=True)
    aggregate_type = models.CharField(max_length=50)
    
    # Which event number this snapshot is current up to
    event_number = models.BigIntegerField()
    
    # Snapshot of the full state at this point
    state = models.JSONField()
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'cao_snapshots'
        indexes = [
            models.Index(fields=['aggregate_id', 'event_number']),
        ]


class Sketch(models.Model):
    """
    2D sketch entity (geometries are based on sketches)
    Uses Event Sourcing for change tracking
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='sketches')
    
    # Metadata
    name = models.CharField(max_length=255, default="Sketch")
    description = models.TextField(blank=True)
    
    # Sketch data (2D geometry + constraints)
    geometry_data = models.JSONField(default=dict)  # Contains points, lines, arcs, circles
    constraints = models.JSONField(default=list)    # Constraint definitions
    
    # Position in 3D space
    plane = models.CharField(max_length=10, default='XY')  # 'XY', 'XZ', 'YZ'
    offset_z = models.FloatField(default=0.0)
    
    # Validation
    is_valid = models.BooleanField(default=False)
    is_closed = models.BooleanField(default=False)  # Closed profile required for extrusion
    
    # History
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    class Meta:
        db_table = 'cao_sketches'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.name} (Project: {self.project.name})"


class Geometry(models.Model):
    """
    3D geometry entity (result of operations like extrude, pocket, etc.)
    Each geometry is immutable and versioned via Event Store
    """
    OPERATION_TYPES = [
        ('sketch', 'Sketch (2D)'),
        ('extrude', 'Extrusion'),
        ('pocket', 'Pocket'),
        ('fillet', 'Fillet'),
        ('chamfer', 'Chamfer'),
        ('thread', 'Thread'),
        ('other', 'Other'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='geometries')
    
    # Metadata
    name = models.CharField(max_length=255, default="Geometry")
    operation_type = models.CharField(max_length=20, choices=OPERATION_TYPES)
    
    # References
    base_sketch = models.ForeignKey(Sketch, on_delete=models.SET_NULL, null=True, blank=True, related_name='geometries_created')
    parent_geometry = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    
    # 3D Model storage
    step_file = models.FileField(upload_to='geometry_models/', null=True, blank=True)
    stl_file = models.FileField(upload_to='geometry_models/', null=True, blank=True)
    
    # Operation parameters (stored as JSON)
    parameters = models.JSONField(default=dict)  # e.g., {'length': 10.0, 'direction': 'Z'}
    
    # Computed properties
    volume = models.FloatField(null=True, blank=True)
    bounding_box = models.JSONField(default=dict)
    
    # Status
    is_valid = models.BooleanField(default=False)
    error_message = models.TextField(blank=True)
    
    # History
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='geometries_created')
    
    class Meta:
        db_table = 'cao_geometries'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', 'operation_type']),
            models.Index(fields=['base_sketch']),
            models.Index(fields=['parent_geometry']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.get_operation_type_display()})"


class Assembly(models.Model):
    """
    Assembly: composition of multiple geometries with relative positioning
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='assemblies')
    
    # Metadata
    name = models.CharField(max_length=255, default="Assembly")
    description = models.TextField(blank=True)
    
    # History
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    class Meta:
        db_table = 'cao_assemblies'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.name} (Project: {self.project.name})"


class AssemblyPart(models.Model):
    """
    References a geometry within an assembly with specific placement/transformation
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    assembly = models.ForeignKey(Assembly, on_delete=models.CASCADE, related_name='parts')
    geometry = models.ForeignKey(Geometry, on_delete=models.CASCADE)
    
    # Placement (position and rotation in assembly)
    position_x = models.FloatField(default=0.0)
    position_y = models.FloatField(default=0.0)
    position_z = models.FloatField(default=0.0)
    
    rotation_x = models.FloatField(default=0.0)  # Roll (degrees)
    rotation_y = models.FloatField(default=0.0)  # Pitch (degrees)
    rotation_z = models.FloatField(default=0.0)  # Yaw (degrees)
    
    scale = models.FloatField(default=1.0)
    
    # Metadata
    part_number = models.IntegerField(default=0)  # Order in assembly
    is_visible = models.BooleanField(default=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'cao_assembly_parts'
        ordering = ['part_number']
        unique_together = [('assembly', 'geometry')]
    
    def __str__(self):
        return f"{self.geometry.name} in {self.assembly.name}"


class OperationHistory(models.Model):
    """
    User-facing operation history for undo/redo UI
    Uses EventStore underneath
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='operation_history')
    
    # Operation details
    operation_type = models.CharField(max_length=100)
    operation_name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    
    # Stack position
    undo_index = models.IntegerField(db_index=True)  # Position in undo stack
    
    # Associated events
    first_event = models.ForeignKey(EventStore, on_delete=models.SET_NULL, null=True, related_name='+')
    last_event = models.ForeignKey(EventStore, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    class Meta:
        db_table = 'cao_operation_history'
        ordering = ['-undo_index']
        indexes = [
            models.Index(fields=['project', 'undo_index']),
        ]
    
    def __str__(self):
        return f"{self.operation_name} (Index: {self.undo_index})"


class CollaborationSession(models.Model):
    """
    Tracks active editing sessions for real-time collaboration
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='collaboration_sessions')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    
    # Session info
    started_at = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    
    # WebSocket connection info
    session_token = models.CharField(max_length=255, unique=True)
    
    class Meta:
        db_table = 'cao_collaboration_sessions'
        indexes = [
            models.Index(fields=['project', 'is_active']),
        ]
