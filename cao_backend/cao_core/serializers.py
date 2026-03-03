"""
DRF Serializers for CAO Core models
Provides REST API serialization for all entities
"""

from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    Project, EventStore, Snapshot, Sketch, Geometry,
    Assembly, AssemblyPart, OperationHistory, CollaborationSession
)


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User authentication and info"""
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']
        read_only_fields = ['id']


class ProjectSerializer(serializers.ModelSerializer):
    """Serializer for Project (root container)"""
    owner_username = serializers.CharField(
        source='owner.username',
        read_only=True
    )
    owner_id = serializers.IntegerField(
        source='owner.id',
        read_only=True
    )
    events_count = serializers.SerializerMethodField()
    sketches_count = serializers.SerializerMethodField()
    geometries_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            'id', 'owner', 'owner_id', 'owner_username', 'name', 'description',
            'created_at', 'updated_at', 'is_active',
            'events_count', 'sketches_count', 'geometries_count'
        ]
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']

    def get_events_count(self, obj):
        return obj.events.count()

    def get_sketches_count(self, obj):
        return obj.sketches.count()

    def get_geometries_count(self, obj):
        return obj.geometries.count()


class EventStoreSerializer(serializers.ModelSerializer):
    """Serializer for Event Store entries"""
    actor_username = serializers.CharField(
        source='actor.username',
        read_only=True,
        required=False
    )
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )

    class Meta:
        model = EventStore
        fields = [
            'id', 'project', 'project_name', 'event_type',
            'event_number', 'timestamp', 'actor', 'actor_username',
            'payload', 'aggregate_id', 'aggregate_type',
            'is_reverted', 'reverted_at'
        ]
        read_only_fields = [
            'id', 'event_number', 'timestamp', 'is_reverted', 'reverted_at'
        ]


class SnapshotSerializer(serializers.ModelSerializer):
    """Serializer for Snapshots (performance optimization)"""
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )

    class Meta:
        model = Snapshot
        fields = [
            'id', 'project', 'project_name',
            'aggregate_id', 'aggregate_type',
            'event_number', 'state', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class SketchSerializer(serializers.ModelSerializer):
    """Serializer for Sketch (2D geometry + constraints)"""
    created_by_username = serializers.CharField(
        source='created_by.username',
        read_only=True,
        required=False
    )
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )
    geometry_count = serializers.SerializerMethodField()

    class Meta:
        model = Sketch
        fields = [
            'id', 'project', 'project_name', 'name', 'description',
            'geometry_data', 'constraints', 'plane', 'offset_z',
            'is_valid', 'is_closed',
            'created_at', 'updated_at', 'created_by', 'created_by_username',
            'geometry_count'
        ]
        read_only_fields = [
            'id', 'project', 'created_at', 'updated_at', 'created_by'
        ]

    def get_geometry_count(self, obj):
        return obj.geometries_created.count()


class GeometrySerializer(serializers.ModelSerializer):
    """Serializer for Geometry (3D models from operations)"""
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )
    base_sketch_name = serializers.CharField(
        source='base_sketch.name',
        read_only=True,
        required=False
    )
    parent_geometry_name = serializers.CharField(
        source='parent_geometry.name',
        read_only=True,
        required=False
    )
    created_by_username = serializers.CharField(
        source='created_by.username',
        read_only=True,
        required=False
    )
    operation_type_display = serializers.CharField(
        source='get_operation_type_display',
        read_only=True
    )
    children_count = serializers.SerializerMethodField()

    class Meta:
        model = Geometry
        fields = [
            'id', 'project', 'project_name', 'name', 'operation_type',
            'operation_type_display', 'base_sketch', 'base_sketch_name',
            'parent_geometry', 'parent_geometry_name',
            'step_file', 'stl_file', 'parameters',
            'volume', 'bounding_box', 'is_valid', 'error_message',
            'created_at', 'updated_at', 'created_by', 'created_by_username',
            'children_count'
        ]
        read_only_fields = [
            'id', 'project', 'created_at', 'updated_at', 'created_by',
            'volume', 'bounding_box', 'is_valid', 'error_message'
        ]

    def get_children_count(self, obj):
        return obj.children.count()


class AssemblyPartSerializer(serializers.ModelSerializer):
    """Serializer for Assembly Part (geometry placement in assembly)"""
    geometry_name = serializers.CharField(
        source='geometry.name',
        read_only=True
    )
    geometry_operation_type = serializers.CharField(
        source='geometry.operation_type',
        read_only=True
    )

    class Meta:
        model = AssemblyPart
        fields = [
            'id', 'assembly', 'geometry', 'geometry_name',
            'geometry_operation_type',
            'position_x', 'position_y', 'position_z',
            'rotation_x', 'rotation_y', 'rotation_z',
            'scale', 'part_number', 'is_visible',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AssemblySerializer(serializers.ModelSerializer):
    """Serializer for Assembly (composition of geometries)"""
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )
    created_by_username = serializers.CharField(
        source='created_by.username',
        read_only=True,
        required=False
    )
    parts = AssemblyPartSerializer(many=True, read_only=True)
    parts_count = serializers.SerializerMethodField()

    class Meta:
        model = Assembly
        fields = [
            'id', 'project', 'project_name', 'name', 'description',
            'created_at', 'updated_at', 'created_by', 'created_by_username',
            'parts', 'parts_count'
        ]
        read_only_fields = [
            'id', 'project', 'created_at', 'updated_at', 'created_by'
        ]

    def get_parts_count(self, obj):
        return obj.parts.count()


class OperationHistorySerializer(serializers.ModelSerializer):
    """Serializer for Operation History (undo/redo stack)"""
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )
    created_by_username = serializers.CharField(
        source='created_by.username',
        read_only=True,
        required=False
    )
    first_event_type = serializers.CharField(
        source='first_event.event_type',
        read_only=True,
        required=False
    )

    class Meta:
        model = OperationHistory
        fields = [
            'id', 'project', 'project_name',
            'operation_type', 'operation_name', 'description',
            'undo_index', 'first_event', 'first_event_type',
            'last_event', 'created_at', 'created_by', 'created_by_username'
        ]
        read_only_fields = [
            'id', 'project', 'undo_index', 'created_at', 'created_by'
        ]


class CollaborationSessionSerializer(serializers.ModelSerializer):
    """Serializer for Collaboration Session (real-time editing)"""
    project_name = serializers.CharField(
        source='project.name',
        read_only=True
    )
    username = serializers.CharField(
        source='user.username',
        read_only=True
    )
    user_email = serializers.CharField(
        source='user.email',
        read_only=True
    )

    class Meta:
        model = CollaborationSession
        fields = [
            'id', 'project', 'project_name', 'user',
            'username', 'user_email',
            'started_at', 'last_activity', 'is_active',
            'session_token'
        ]
        read_only_fields = [
            'id', 'project', 'user', 'started_at',
            'last_activity', 'session_token'
        ]
