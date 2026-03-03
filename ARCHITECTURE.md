# Architecture Complète - Application CAO Web Django/Trame/CadQuery

## Table des Matières
1. [Vue d'ensemble](#vue-densemble)
2. [Schéma de données](#schéma-de-données)
3. [Système d'événements (Event Sourcing)](#système-dévénements-event-sourcing)
4. [Système de contraintes 2D](#système-de-contraintes-2d)
5. [Opérations CAO modulaires](#opérations-cao-modulaires)
6. [Flux de données complet](#flux-de-données-complet)
7. [Stack technique](#stack-technique)
8. [Plan d'implémentation](#plan-dimplémentation)
9. [Risques et points critiques](#risques-et-points-critiques)
10. [Recommandations de dépendances](#recommandations-de-dépendances)

---

## Vue d'ensemble

### Principes de conception
- **Event Sourcing** : Chaque action utilisateur crée un événement immuable
- **CQRS** : Séparation lecture (projections) / écriture (événements)
- **Modularité** : Django apps pour chaque domaine métier
- **Temps réel** : WebSocket pour collaboration synchrone
- **Calculé** : Géométrie générée dynamiquement depuis événements

### Flux applicatif global

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Trame)                           │
│  - UI 2D Sketcher (Cassowary solver)                        │
│  - Viewer 3D (CadQuery/Three.js)                            │
│  - Contrôles temps réel                                      │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket + REST
┌────────────────────▼────────────────────────────────────────┐
│              API Django (Trame/Channels)                     │
├─────────────┬─────────────┬──────────────┬─────────────────┤
│  Sketcher   │  CAO Engine │  Assembly    │  Collaboration  │
│  Manager    │  (CadQuery) │  Manager     │  (Redis)        │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│           Event Store + Event Bus                            │
│  - PostgreSQL (immutable append-only)                        │
│  - Redis (cache événements récents)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│       Projections/Views (Lecture optimisée)                  │
│  - Geometry State (cache géométrique)                        │
│  - Sketch State (état contraintes)                           │
│  - Assembly State (arbres d'assemblage)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Schéma de données

### Structure relationnelle complète

#### 1. Module Utilisateurs & Workspace (`auth_workspace`)

```python
# Core organizational models
class Workspace(models.Model):
    """Espace de travail collaboratif"""
    id = UUIDField(primary_key=True, default=uuid4)
    name = CharField(max_length=255, unique=True)
    owner = ForeignKey(User, on_delete=CASCADE, related_name='owned_workspaces')
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)
    
    # Configuration
    max_collaborators = IntegerField(default=10)
    retention_days = IntegerField(default=90)  # Rétention événements
    
    class Meta:
        db_table = 'workspaces'
        indexes = [Index(fields=['owner', 'created_at'])]

class WorkspaceCollaborator(models.Model):
    """Accès collaboratif"""
    ROLE_CHOICES = [
        ('viewer', 'Viewer'),
        ('editor', 'Editor'),
        ('admin', 'Admin'),
    ]
    
    workspace = ForeignKey(Workspace, CASCADE, related_name='collaborators')
    user = ForeignKey(User, CASCADE, related_name='workspace_access')
    role = CharField(max_length=20, choices=ROLE_CHOICES, default='viewer')
    joined_at = DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = [['workspace', 'user']]
        db_table = 'workspace_collaborators'

class Session(models.Model):
    """Sessions WebSocket"""
    id = UUIDField(primary_key=True, default=uuid4)
    user = ForeignKey(User, CASCADE, related_name='cao_sessions')
    workspace = ForeignKey(Workspace, CASCADE, related_name='active_sessions')
    
    connected_at = DateTimeField(auto_now_add=True)
    last_activity = DateTimeField(auto_now=True)
    channel_name = CharField(max_length=255)  # Channels layer
    
    class Meta:
        db_table = 'sessions'
        indexes = [Index(fields=['workspace', 'user'])]
```

#### 2. Module Projets & Documents (`projects`)

```python
class Project(models.Model):
    """Projet CAO contenant des pièces et assemblages"""
    id = UUIDField(primary_key=True, default=uuid4)
    workspace = ForeignKey(Workspace, CASCADE, related_name='projects')
    name = CharField(max_length=255)
    description = TextField(blank=True)
    
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)
    created_by = ForeignKey(User, SET_NULL, null=True)
    
    # Métadonnées
    units = CharField(max_length=10, default='mm')  # mm, cm, m, in
    precision = FloatField(default=0.01)  # Précision calculs
    
    class Meta:
        db_table = 'projects'
        unique_together = [['workspace', 'name']]
        indexes = [Index(fields=['workspace', 'created_at'])]

class Part(models.Model):
    """Pièce CAO (contient sketches et opérations)"""
    id = UUIDField(primary_key=True, default=uuid4)
    project = ForeignKey(Project, CASCADE, related_name='parts')
    name = CharField(max_length=255)
    
    # Historique d'état
    current_event_id = UUIDField(null=True)  # Dernier événement appliqué
    current_geometry = JSONField(default=dict, blank=True)  # Cache geometry
    
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)
    locked_by = ForeignKey(User, SET_NULL, null=True, blank=True)
    
    class Meta:
        db_table = 'parts'
        unique_together = [['project', 'name']]
        indexes = [Index(fields=['project', 'updated_at'])]

class Sketch(models.Model):
    """Esquisse 2D avec contraintes"""
    PLANE_CHOICES = [
        ('XY', 'XY Plane'),
        ('YZ', 'YZ Plane'),
        ('XZ', 'XZ Plane'),
        ('face', 'Face'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    part = ForeignKey(Part, CASCADE, related_name='sketches')
    name = CharField(max_length=255)
    
    # Positionnement
    plane = CharField(max_length=10, choices=PLANE_CHOICES)
    plane_offset = FloatField(default=0.0)
    origin_x = FloatField(default=0.0)
    origin_y = FloatField(default=0.0)
    
    # Géométrie actuelle
    current_event_id = UUIDField(null=True)
    geometry_data = JSONField(default=dict)  # Points, lignes, arcs
    constraints_data = JSONField(default=dict)  # État Cassowary solver
    
    is_active = BooleanField(default=False)
    created_at = DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'sketches'
        unique_together = [['part', 'name']]
```

#### 3. Module Événements (`events`)

```python
class Event(models.Model):
    """Event Sourcing - Immuable append-only"""
    EVENT_TYPES = [
        # Sketcher
        ('sketch.created', 'Sketch Created'),
        ('sketch.geometry_added', 'Geometry Added'),
        ('sketch.constraint_added', 'Constraint Added'),
        ('sketch.constraint_removed', 'Constraint Removed'),
        ('sketch.geometry_modified', 'Geometry Modified'),
        ('sketch.geometry_deleted', 'Geometry Deleted'),
        
        # CAO Operations
        ('part.operation_added', 'Operation Added'),
        ('part.operation_modified', 'Operation Modified'),
        ('part.operation_deleted', 'Operation Deleted'),
        ('part.operation_reordered', 'Operation Reordered'),
        
        # Assembly
        ('assembly.created', 'Assembly Created'),
        ('assembly.component_added', 'Component Added'),
        ('assembly.constraint_added', 'Assembly Constraint Added'),
        ('assembly.component_removed', 'Component Removed'),
        
        # Undo/Redo
        ('undo', 'Undo'),
        ('redo', 'Redo'),
        
        # Collaboration
        ('lock_acquired', 'Lock Acquired'),
        ('lock_released', 'Lock Released'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    aggregate_id = UUIDField()  # ID de l'entité (Sketch, Part, Assembly)
    aggregate_type = CharField(max_length=50)  # 'Sketch', 'Part', 'Assembly'
    event_type = CharField(max_length=50, choices=EVENT_TYPES)
    
    # Données de l'événement
    data = JSONField()  # Payload complet
    metadata = JSONField(default=dict)  # {user_id, timestamp_client, etc}
    
    # Sequencing
    sequence_number = BigIntegerField()  # Numéro pour ordre total
    timestamp = DateTimeField(auto_now_add=True, db_index=True)
    user = ForeignKey(User, SET_NULL, null=True, related_name='events_created')
    
    # Versioning
    version = IntegerField()  # Version de l'agrégat
    workspace = ForeignKey(Workspace, CASCADE, related_name='events')
    
    class Meta:
        db_table = 'events'
        # CRITICAL: Append-only, non modifiable
        constraints = [
            CheckConstraint(
                check=~Q(id__isnull=True),
                name='event_id_not_null'
            ),
        ]
        indexes = [
            Index(fields=['aggregate_id', 'aggregate_type']),
            Index(fields=['workspace', 'timestamp']),
            Index(fields=['event_type', 'timestamp']),
            Index(fields=['user', 'timestamp']),
        ]
        
    def save(self, *args, **kwargs):
        if self.pk:  # Si déjà en BD
            raise ProtectedError("Events are immutable - cannot update", self)
        super().save(*args, **kwargs)

class EventSnapshot(models.Model):
    """Snapshots pour optimiser rechargement (Event Sourcing)"""
    id = UUIDField(primary_key=True, default=uuid4)
    aggregate_id = UUIDField()
    aggregate_type = CharField(max_length=50)
    
    version = IntegerField()  # Version du snapshot
    state = JSONField()  # État complet à cette version
    timestamp = DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'event_snapshots'
        unique_together = [['aggregate_id', 'version']]
        indexes = [Index(fields=['aggregate_id', 'version'])]

class UndoRedoStack(models.Model):
    """Pile Undo/Redo par utilisateur et partie"""
    id = UUIDField(primary_key=True, default=uuid4)
    user = ForeignKey(User, CASCADE)
    part = ForeignKey(Part, CASCADE)
    
    undo_stack = JSONField(default=list)  # [event_id, event_id, ...]
    redo_stack = JSONField(default=list)
    
    updated_at = DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'undo_redo_stacks'
        unique_together = [['user', 'part']]
```

#### 4. Module Opérations CAO (`cad_operations`)

```python
class Operation(models.Model):
    """Opération CAO (Pad/Pocket/Fillet/etc)"""
    OPERATION_TYPES = [
        ('pad', 'Extrusion'),
        ('pocket', 'Poche'),
        ('fillet', 'Filetage'),
        ('chamfer', 'Chanfrein'),
        ('revolve', 'Révolution'),
        ('loft', 'Balayage'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    part = ForeignKey(Part, CASCADE, related_name='operations')
    
    name = CharField(max_length=255)
    operation_type = CharField(max_length=20, choices=OPERATION_TYPES)
    
    # Données spécifiques opération
    parameters = JSONField()  # {depth: 10, sketch_id: xxx, ...}
    
    # Historique
    order_in_sequence = IntegerField()  # Ordre d'exécution
    base_feature_id = UUIDField(null=True)  # Opération précédente
    
    # Géométrie
    computed_geometry = JSONField(null=True)  # STEP/STL/BREP sérialisé
    bounding_box = JSONField(null=True)  # {min, max}
    
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'operations'
        unique_together = [['part', 'name']]
        indexes = [
            Index(fields=['part', 'order_in_sequence']),
            Index(fields=['part', 'created_at']),
        ]
        ordering = ['order_in_sequence']

class OperationParameter(models.Model):
    """Paramètres liés à features (linking)"""
    operation = ForeignKey(Operation, CASCADE, related_name='linked_parameters')
    
    parameter_name = CharField(max_length=100)
    linked_sketch = ForeignKey(Sketch, SET_NULL, null=True, blank=True)
    linked_feature_id = UUIDField(null=True)  # Face/Edge à filéter
    
    value = FloatField(null=True)
    unit = CharField(max_length=10, default='mm')
```

#### 5. Module Assemblages (`assemblies`)

```python
class Assembly(models.Model):
    """Assemblage multi-pièces"""
    id = UUIDField(primary_key=True, default=uuid4)
    project = ForeignKey(Project, CASCADE, related_name='assemblies')
    name = CharField(max_length=255)
    
    # Structure hiérarchique
    root_component = OneToOneField(
        'AssemblyComponent',
        SET_NULL,
        null=True,
        related_name='assembly_root'
    )
    
    current_event_id = UUIDField(null=True)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'assemblies'
        unique_together = [['project', 'name']]

class AssemblyComponent(models.Model):
    """Composant dans assemblage (peut être Part ou sous-Assembly)"""
    id = UUIDField(primary_key=True, default=uuid4)
    assembly = ForeignKey(Assembly, CASCADE, related_name='components')
    
    # Référence pièce
    referenced_part = ForeignKey(Part, SET_NULL, null=True, blank=True)
    referenced_assembly = ForeignKey(
        Assembly,
        SET_NULL,
        null=True,
        blank=True,
        related_name='instances'
    )
    
    name = CharField(max_length=255)
    
    # Placement
    position_x = FloatField(default=0.0)
    position_y = FloatField(default=0.0)
    position_z = FloatField(default=0.0)
    rotation_x = FloatField(default=0.0)  # Euler angles
    rotation_y = FloatField(default=0.0)
    rotation_z = FloatField(default=0.0)
    
    # Hiérarchie
    parent_component = ForeignKey(
        'self',
        SET_NULL,
        null=True,
        blank=True,
        related_name='children'
    )
    
    visibility = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'assembly_components'
        indexes = [Index(fields=['assembly', 'parent_component'])]

class AssemblyConstraint(models.Model):
    """Contraintes d'assemblage (coïncidence, parallèle, etc)"""
    CONSTRAINT_TYPES = [
        ('coincident', 'Coïncidence'),
        ('parallel', 'Parallèle'),
        ('perpendicular', 'Perpendiculaire'),
        ('concentric', 'Concentrique'),
        ('distance', 'Distance'),
        ('fixed', 'Fixe'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    assembly = ForeignKey(Assembly, CASCADE, related_name='constraints')
    
    constraint_type = CharField(max_length=20, choices=CONSTRAINT_TYPES)
    
    # Références géométriques
    component1 = ForeignKey(
        AssemblyComponent,
        CASCADE,
        related_name='constraints_as_comp1'
    )
    face_edge_1 = CharField(max_length=50)  # "face_3", "edge_5"
    
    component2 = ForeignKey(
        AssemblyComponent,
        SET_NULL,
        null=True,
        blank=True,
        related_name='constraints_as_comp2'
    )
    face_edge_2 = CharField(max_length=50, blank=True)
    
    # Données
    distance = FloatField(null=True)  # Pour contraintes de distance
    parameters = JSONField(default=dict)
    
    is_satisfied = BooleanField(default=True)
    
    class Meta:
        db_table = 'assembly_constraints'
```

#### 6. Module Collaboration (`collaboration`)

```python
class Lock(models.Model):
    """Locks distribués (pessimistic locking)"""
    LOCK_TYPES = [
        ('sketch', 'Sketch'),
        ('part', 'Part'),
        ('assembly', 'Assembly'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    
    lock_type = CharField(max_length=20, choices=LOCK_TYPES)
    target_id = UUIDField()  # ID de la ressource
    
    owner = ForeignKey(User, CASCADE, related_name='locks_owned')
    session = ForeignKey(Session, CASCADE, related_name='locks')
    
    acquired_at = DateTimeField(auto_now_add=True)
    expires_at = DateTimeField()  # Expiration (heartbeat)
    
    class Meta:
        db_table = 'locks'
        unique_together = [['lock_type', 'target_id']]
        indexes = [Index(fields=['target_id', 'owner'])]

class Notification(models.Model):
    """Notifications temps réel"""
    NOTIFICATION_TYPES = [
        ('user_joined', 'User Joined'),
        ('user_left', 'User Left'),
        ('geometry_changed', 'Geometry Changed'),
        ('lock_released', 'Lock Released'),
        ('error', 'Error'),
    ]
    
    id = UUIDField(primary_key=True, default=uuid4)
    workspace = ForeignKey(Workspace, CASCADE)
    recipient = ForeignKey(User, CASCADE, related_name='notifications')
    
    notification_type = CharField(max_length=30, choices=NOTIFICATION_TYPES)
    data = JSONField()
    
    is_read = BooleanField(default=False)
    created_at = DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'notifications'
        indexes = [
            Index(fields=['recipient', 'is_read']),
            Index(fields=['workspace', 'created_at']),
        ]
```

#### 7. Index et migrations recommandées

```sql
-- CRITICAL INDICES
CREATE INDEX CONCURRENTLY idx_events_aggregate ON events(aggregate_id, aggregate_type);
CREATE INDEX CONCURRENTLY idx_events_workspace_time ON events(workspace_id, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_parts_project ON parts(project_id);
CREATE INDEX CONCURRENTLY idx_sketches_part ON sketches(part_id);
CREATE INDEX CONCURRENTLY idx_operations_part_order ON operations(part_id, order_in_sequence);
CREATE INDEX CONCURRENTLY idx_locks_target ON locks(lock_type, target_id);
CREATE INDEX CONCURRENTLY idx_sessions_workspace ON sessions(workspace_id, user_id);

-- CONSTRAINT CHECKS
ALTER TABLE events ADD CONSTRAINT event_immutable 
    GENERATED ALWAYS AS () STORED;
```

---

## Système d'événements (Event Sourcing)

### Architecture d'événements

#### 1. Types d'événements hiérarchisés

```python
# events/models.py - Définition des événements

class BaseEvent(ABC):
    """Classe de base pour tous les événements"""
    
    def __init__(self, aggregate_id: UUID, aggregate_type: str, version: int):
        self.aggregate_id = aggregate_id
        self.aggregate_type = aggregate_type
        self.version = version
        self.timestamp = datetime.now(timezone.utc)
    
    @abstractmethod
    def to_dict(self) -> dict:
        """Sérialiser l'événement"""
        pass
    
    @staticmethod
    @abstractmethod
    def from_dict(data: dict) -> 'BaseEvent':
        """Désérialiser l'événement"""
        pass


# ============ SKETCH EVENTS ============
class SketchCreatedEvent(BaseEvent):
    """Sketch créée"""
    def __init__(self, sketch_id: UUID, part_id: UUID, name: str, plane: str):
        super().__init__(sketch_id, 'Sketch', 1)
        self.part_id = part_id
        self.name = name
        self.plane = plane
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'sketch.created',
            'sketch_id': str(self.aggregate_id),
            'part_id': str(self.part_id),
            'name': self.name,
            'plane': self.plane,
        }

class GeometryAddedEvent(BaseEvent):
    """Géométrie ajoutée au sketch"""
    def __init__(
        self,
        sketch_id: UUID,
        geometry_id: str,
        geometry_type: str,  # 'point', 'line', 'arc', 'circle'
        data: dict  # coords, params
    ):
        super().__init__(sketch_id, 'Sketch', 1)
        self.geometry_id = geometry_id
        self.geometry_type = geometry_type
        self.data = data
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'sketch.geometry_added',
            'sketch_id': str(self.aggregate_id),
            'geometry_id': self.geometry_id,
            'geometry_type': self.geometry_type,
            'data': self.data,
        }

class ConstraintAddedEvent(BaseEvent):
    """Contrainte ajoutée"""
    def __init__(
        self,
        sketch_id: UUID,
        constraint_id: str,
        constraint_type: str,  # 'distance', 'coincident', 'parallel'
        variables: list[str],  # IDs des géométries impliquées
        value: float = None
    ):
        super().__init__(sketch_id, 'Sketch', 1)
        self.constraint_id = constraint_id
        self.constraint_type = constraint_type
        self.variables = variables
        self.value = value
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'sketch.constraint_added',
            'sketch_id': str(self.aggregate_id),
            'constraint_id': self.constraint_id,
            'constraint_type': self.constraint_type,
            'variables': self.variables,
            'value': self.value,
        }

class ConstraintRemovedEvent(BaseEvent):
    """Contrainte supprimée"""
    def __init__(self, sketch_id: UUID, constraint_id: str):
        super().__init__(sketch_id, 'Sketch', 1)
        self.constraint_id = constraint_id
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'sketch.constraint_removed',
            'sketch_id': str(self.aggregate_id),
            'constraint_id': self.constraint_id,
        }


# ============ CAD OPERATION EVENTS ============
class OperationAddedEvent(BaseEvent):
    """Opération CAO ajoutée"""
    def __init__(
        self,
        part_id: UUID,
        operation_id: UUID,
        name: str,
        operation_type: str,  # 'pad', 'pocket'
        parameters: dict
    ):
        super().__init__(part_id, 'Part', 1)
        self.operation_id = operation_id
        self.name = name
        self.operation_type = operation_type
        self.parameters = parameters
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'part.operation_added',
            'part_id': str(self.aggregate_id),
            'operation_id': str(self.operation_id),
            'name': self.name,
            'operation_type': self.operation_type,
            'parameters': self.parameters,
        }

class OperationReorderedEvent(BaseEvent):
    """Opérations réordonnées (drag-drop)"""
    def __init__(self, part_id: UUID, new_order: list[UUID]):
        super().__init__(part_id, 'Part', 1)
        self.new_order = new_order
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'part.operation_reordered',
            'part_id': str(self.aggregate_id),
            'new_order': [str(id) for id in self.new_order],
        }


# ============ ASSEMBLY EVENTS ============
class AssemblyCreatedEvent(BaseEvent):
    """Assemblage créé"""
    def __init__(self, assembly_id: UUID, name: str):
        super().__init__(assembly_id, 'Assembly', 1)
        self.name = name
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'assembly.created',
            'assembly_id': str(self.aggregate_id),
            'name': self.name,
        }

class ComponentAddedEvent(BaseEvent):
    """Composant ajouté à assemblage"""
    def __init__(
        self,
        assembly_id: UUID,
        component_id: UUID,
        referenced_part_id: UUID = None,
        name: str = None,
        placement: dict = None
    ):
        super().__init__(assembly_id, 'Assembly', 1)
        self.component_id = component_id
        self.referenced_part_id = referenced_part_id
        self.name = name
        self.placement = placement or {'x': 0, 'y': 0, 'z': 0}
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'assembly.component_added',
            'assembly_id': str(self.aggregate_id),
            'component_id': str(self.component_id),
            'referenced_part_id': str(self.referenced_part_id) if self.referenced_part_id else None,
            'name': self.name,
            'placement': self.placement,
        }

class AssemblyConstraintAddedEvent(BaseEvent):
    """Contrainte d'assemblage ajoutée"""
    def __init__(
        self,
        assembly_id: UUID,
        constraint_id: UUID,
        constraint_type: str,
        comp1_id: UUID,
        face_edge_1: str,
        comp2_id: UUID = None,
        face_edge_2: str = None,
        distance: float = None
    ):
        super().__init__(assembly_id, 'Assembly', 1)
        self.constraint_id = constraint_id
        self.constraint_type = constraint_type
        self.comp1_id = comp1_id
        self.face_edge_1 = face_edge_1
        self.comp2_id = comp2_id
        self.face_edge_2 = face_edge_2
        self.distance = distance
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'assembly.constraint_added',
            'assembly_id': str(self.aggregate_id),
            'constraint_id': str(self.constraint_id),
            'constraint_type': self.constraint_type,
            'comp1_id': str(self.comp1_id),
            'face_edge_1': self.face_edge_1,
            'comp2_id': str(self.comp2_id) if self.comp2_id else None,
            'face_edge_2': self.face_edge_2,
            'distance': self.distance,
        }


# ============ UNDO/REDO EVENTS ============
class UndoEvent(BaseEvent):
    """Undo actionné"""
    def __init__(self, part_id: UUID, user_id: UUID, reverted_event_id: UUID):
        super().__init__(part_id, 'Part', 1)
        self.user_id = user_id
        self.reverted_event_id = reverted_event_id
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'undo',
            'part_id': str(self.aggregate_id),
            'user_id': str(self.user_id),
            'reverted_event_id': str(self.reverted_event_id),
        }

class RedoEvent(BaseEvent):
    """Redo actionné"""
    def __init__(self, part_id: UUID, user_id: UUID, reapplied_event_id: UUID):
        super().__init__(part_id, 'Part', 1)
        self.user_id = user_id
        self.reapplied_event_id = reapplied_event_id
    
    def to_dict(self) -> dict:
        return {
            'event_type': 'redo',
            'part_id': str(self.aggregate_id),
            'user_id': str(self.user_id),
            'reapplied_event_id': str(self.reapplied_event_id),
        }
```

#### 2. Event Store (Persistance et Broadcasting)

```python
# events/event_store.py

from typing import List, Dict, Optional
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import json

class EventStore:
    """
    Event Store central avec:
    - Persistance PostgreSQL (append-only)
    - Cache Redis (événements récents)
    - Broadcasting via Redis Pub/Sub
    """
    
    def __init__(self):
        self.db = None  # Django ORM
        self.cache = cache  # Django cache framework
        self.channel_layer = get_channel_layer()
    
    def append_event(
        self,
        event: BaseEvent,
        user_id: UUID,
        workspace_id: UUID,
        metadata: Dict = None
    ) -> Event:
        """
        Ajouter événement de façon atomique
        Atomicité garantie: UPDATE + INSERT ou ROLLBACK
        """
        metadata = metadata or {}
        
        try:
            # Déterminer le numéro de séquence
            with transaction.atomic():
                last_event = Event.objects.filter(
                    workspace=workspace_id
                ).order_by('-sequence_number').first()
                
                next_seq = (last_event.sequence_number + 1) if last_event else 1
                
                # Insérer l'événement (immutable)
                db_event = Event.objects.create(
                    aggregate_id=event.aggregate_id,
                    aggregate_type=event.aggregate_type,
                    event_type=event.to_dict()['event_type'],
                    data=event.to_dict(),
                    metadata={
                        **metadata,
                        'timestamp_client': event.timestamp.isoformat(),
                        'user_id': str(user_id),
                    },
                    sequence_number=next_seq,
                    version=event.version,
                    user_id=user_id,
                    workspace_id=workspace_id,
                )
                
                # Cache événement dans Redis (TTL = 7 jours)
                cache_key = f"event:{workspace_id}:{event.aggregate_id}"
                events_list = cache.get(cache_key, [])
                events_list.append(event.to_dict())
                cache.set(cache_key, events_list, 7*24*3600)
                
                # Broadcaster vers tous les clients connectés
                self._broadcast_event(workspace_id, db_event)
                
                return db_event
        
        except Exception as e:
            logger.error(f"Event append failed: {e}")
            raise
    
    def get_events_for_aggregate(
        self,
        aggregate_id: UUID,
        from_version: int = 0
    ) -> List[Event]:
        """Récupérer tous les événements pour une entité"""
        return Event.objects.filter(
            aggregate_id=aggregate_id,
            version__gte=from_version
        ).order_by('version')
    
    def get_events_since(
        self,
        workspace_id: UUID,
        timestamp: datetime
    ) -> List[Event]:
        """Récupérer événements récents (pour sync clients)"""
        return Event.objects.filter(
            workspace=workspace_id,
            timestamp__gte=timestamp
        ).order_by('timestamp')
    
    def create_snapshot(
        self,
        aggregate_id: UUID,
        version: int,
        state: Dict
    ):
        """Créer snapshot pour optimization"""
        EventSnapshot.objects.create(
            aggregate_id=aggregate_id,
            version=version,
            state=state
        )
    
    def _broadcast_event(self, workspace_id: UUID, event: Event):
        """Envoyer événement à tous les clients"""
        async_to_sync(self.channel_layer.group_send)(
            f"workspace_{workspace_id}",
            {
                "type": "event.broadcast",
                "event_id": str(event.id),
                "aggregate_id": str(event.aggregate_id),
                "event_type": event.event_type,
                "data": event.data,
                "timestamp": event.timestamp.isoformat(),
            }
        )


# Singleton
event_store = EventStore()
```

#### 3. Projection/State Management

```python
# events/projections.py

class SketchProjection:
    """
    Projection pour état actuel d'un Sketch
    Recalculé depuis les événements
    """
    
    def __init__(self, sketch_id: UUID):
        self.sketch_id = sketch_id
        self.geometry_map = {}  # {geometry_id: {type, coords}}
        self.constraints_map = {}  # {constraint_id: {...}}
        self.version = 0
    
    def rebuild_from_events(self):
        """Reconstruire l'état depuis tous les événements"""
        events = Event.objects.filter(
            aggregate_id=self.sketch_id,
            aggregate_type='Sketch'
        ).order_by('version')
        
        for event in events:
            self._apply_event(event.data)
        
        self.version = events.count()
    
    def _apply_event(self, event_data: dict):
        """Appliquer événement à la projection"""
        event_type = event_data['event_type']
        
        if event_type == 'sketch.geometry_added':
            geo_id = event_data['geometry_id']
            self.geometry_map[geo_id] = {
                'type': event_data['geometry_type'],
                'data': event_data['data'],
            }
        
        elif event_type == 'sketch.constraint_added':
            const_id = event_data['constraint_id']
            self.constraints_map[const_id] = {
                'type': event_data['constraint_type'],
                'variables': event_data['variables'],
                'value': event_data['value'],
            }
        
        elif event_type == 'sketch.constraint_removed':
            del self.constraints_map[event_data['constraint_id']]
        
        elif event_type == 'sketch.geometry_deleted':
            del self.geometry_map[event_data['geometry_id']]
    
    def get_state(self) -> dict:
        """État actuel pour envoi au client"""
        return {
            'sketch_id': str(self.sketch_id),
            'geometry': self.geometry_map,
            'constraints': self.constraints_map,
            'version': self.version,
        }


class PartProjection:
    """Projection pour état d'une Part"""
    
    def __init__(self, part_id: UUID):
        self.part_id = part_id
        self.operations = {}  # {op_id: {...}}
        self.operation_order = []
        self.version = 0
    
    def rebuild_from_events(self):
        """Reconstruire depuis événements"""
        events = Event.objects.filter(
            aggregate_id=self.part_id,
            aggregate_type='Part'
        ).order_by('version')
        
        for event in events:
            self._apply_event(event.data)
        
        self.version = events.count()
    
    def _apply_event(self, event_data: dict):
        """Appliquer événement"""
        event_type = event_data['event_type']
        
        if event_type == 'part.operation_added':
            op_id = event_data['operation_id']
            self.operations[op_id] = {
                'name': event_data['name'],
                'type': event_data['operation_type'],
                'parameters': event_data['parameters'],
            }
            self.operation_order.append(op_id)
        
        elif event_type == 'part.operation_reordered':
            self.operation_order = event_data['new_order']
        
        elif event_type == 'part.operation_deleted':
            op_id = event_data['operation_id']
            if op_id in self.operations:
                del self.operations[op_id]
            if op_id in self.operation_order:
                self.operation_order.remove(op_id)
    
    def get_state(self) -> dict:
        """État actuel"""
        return {
            'part_id': str(self.part_id),
            'operations': [
                {**self.operations[op_id], 'id': op_id}
                for op_id in self.operation_order
                if op_id in self.operations
            ],
            'version': self.version,
        }
```

---

## Système de contraintes 2D

### Intégration Cassowary Solver

```python
# sketcher/constraint_solver.py

from cassowary import (
    ClVariable, Constraint, SimplexSolver,
    Expression, Strength
)
from typing import Dict, Tuple, Optional

class ConstraintVariable:
    """Wrapper pour variables Cassowary avec metadata"""
    def __init__(self, name: str, initial_value: float = 0.0):
        self.name = name
        self.cl_var = ClVariable(name, initial_value)
        self.value = initial_value
    
    def set_value(self, value: float):
        self.value = value
        self.cl_var.set_value(value)
    
    def get_value(self) -> float:
        return self.cl_var.get_value()


class Point2D:
    """Point 2D avec variables Cassowary"""
    def __init__(self, name: str, x: float = 0.0, y: float = 0.0):
        self.name = name
        self.x = ConstraintVariable(f"{name}_x", x)
        self.y = ConstraintVariable(f"{name}_y", y)
    
    def get_coords(self) -> Tuple[float, float]:
        return (self.x.get_value(), self.y.get_value())
    
    def set_coords(self, x: float, y: float):
        self.x.set_value(x)
        self.y.set_value(y)


class SketchConstraintSolver:
    """
    Solver pour contraintes 2D du Sketcher
    Utilise Cassowary pour résoudre en temps réel
    """
    
    def __init__(self):
        self.solver = SimplexSolver()
        self.points: Dict[str, Point2D] = {}
        self.constraints_map: Dict[str, Constraint] = {}
        self.variables: Dict[str, ClVariable] = {}
    
    def add_point(self, point_id: str, x: float = 0.0, y: float = 0.0) -> Point2D:
        """Ajouter un point"""
        point = Point2D(point_id, x, y)
        self.points[point_id] = point
        return point
    
    def add_distance_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        distance: float,
        strength: Strength = Strength.strong
    ):
        """Ajouter contrainte de distance entre deux points"""
        if point1_id not in self.points or point2_id not in self.points:
            raise ValueError(f"Points {point1_id} or {point2_id} not found")
        
        p1 = self.points[point1_id]
        p2 = self.points[point2_id]
        
        # Distance = sqrt((x2-x1)² + (y2-y1)²)
        # Pour simplifier: utiliser distance orthogonale
        expr = Expression([
            (p2.x.cl_var, 1.0),
            (p1.x.cl_var, -1.0)
        ])
        constraint = Constraint(expr, GE, distance)
        
        self.solver.add_constraint(constraint)
        self.constraints_map[constraint_id] = constraint
    
    def add_coincident_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.required
    ):
        """Forcer deux points coïncidents"""
        if point1_id not in self.points or point2_id not in self.points:
            raise ValueError(f"Points not found")
        
        p1 = self.points[point1_id]
        p2 = self.points[point2_id]
        
        # x1 == x2 ET y1 == y2
        constraint_x = Constraint(
            Expression([(p1.x.cl_var, 1.0), (p2.x.cl_var, -1.0)]),
            EQ,
            0,
            strength
        )
        constraint_y = Constraint(
            Expression([(p1.y.cl_var, 1.0), (p2.y.cl_var, -1.0)]),
            EQ,
            0,
            strength
        )
        
        self.solver.add_constraint(constraint_x)
        self.solver.add_constraint(constraint_y)
        self.constraints_map[f"{constraint_id}_x"] = constraint_x
        self.constraints_map[f"{constraint_id}_y"] = constraint_y
    
    def add_horizontal_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.strong
    ):
        """Forcer deux points horizontalement alignés"""
        p1 = self.points[point1_id]
        p2 = self.points[point2_id]
        
        # y1 == y2
        constraint = Constraint(
            Expression([(p1.y.cl_var, 1.0), (p2.y.cl_var, -1.0)]),
            EQ,
            0,
            strength
        )
        self.solver.add_constraint(constraint)
        self.constraints_map[constraint_id] = constraint
    
    def add_vertical_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        strength: Strength = Strength.strong
    ):
        """Forcer deux points verticalement alignés"""
        p1 = self.points[point1_id]
        p2 = self.points[point2_id]
        
        # x1 == x2
        constraint = Constraint(
            Expression([(p1.x.cl_var, 1.0), (p2.x.cl_var, -1.0)]),
            EQ,
            0,
            strength
        )
        self.solver.add_constraint(constraint)
        self.constraints_map[constraint_id] = constraint
    
    def add_angle_constraint(
        self,
        constraint_id: str,
        point1_id: str,
        point2_id: str,
        point3_id: str,
        angle_degrees: float,
        strength: Strength = Strength.strong
    ):
        """Contrainte d'angle entre trois points"""
        # Complexe - nécessite calcul trigonométrique
        # Utiliser projection pour simplifier
        pass
    
    def fix_point(self, point_id: str, x: float, y: float):
        """Fixer un point à une position"""
        if point_id not in self.points:
            raise ValueError(f"Point {point_id} not found")
        
        p = self.points[point_id]
        constraint_x = Constraint(p.x.cl_var, EQ, x, Strength.required)
        constraint_y = Constraint(p.y.cl_var, EQ, y, Strength.required)
        
        self.solver.add_constraint(constraint_x)
        self.solver.add_constraint(constraint_y)
        
        self.constraints_map[f"{point_id}_fix_x"] = constraint_x
        self.constraints_map[f"{point_id}_fix_y"] = constraint_y
    
    def remove_constraint(self, constraint_id: str):
        """Supprimer une contrainte"""
        if constraint_id in self.constraints_map:
            constraint = self.constraints_map.pop(constraint_id)
            self.solver.remove_constraint(constraint)
    
    def solve(self) -> bool:
        """
        Résoudre le système de contraintes
        Retourne True si solution trouvée
        """
        try:
            self.solver.resolve()
            return True
        except Exception as e:
            logger.error(f"Solver failed: {e}")
            return False
    
    def get_point_position(self, point_id: str) -> Tuple[float, float]:
        """Obtenir position résolue"""
        if point_id not in self.points:
            raise ValueError(f"Point {point_id} not found")
        return self.points[point_id].get_coords()
    
    def get_all_positions(self) -> Dict[str, Tuple[float, float]]:
        """Obtenir toutes les positions résolues"""
        return {
            point_id: point.get_coords()
            for point_id, point in self.points.items()
        }
    
    def get_infeasibility_report(self) -> Optional[Dict]:
        """Rapport sur infaisabilité du système"""
        # Cassowary peut avoir des contraintes conflictuelles
        # Retourner lesquelles sont violées
        return {
            'infeasible': not self.solver.is_feasible(),
            'violated_constraints': []
        }


# ============ API HAUT NIVEAU ============

class SketchEngine:
    """Moteur de Sketch haut niveau"""
    
    def __init__(self, sketch_id: UUID):
        self.sketch_id = sketch_id
        self.solver = SketchConstraintSolver()
        self.geometry_entities = {}  # geometry_id -> {type, data}
    
    def add_line(
        self,
        geometry_id: str,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float
    ):
        """Ajouter une ligne"""
        start_id = f"{geometry_id}_start"
        end_id = f"{geometry_id}_end"
        
        self.solver.add_point(start_id, start_x, start_y)
        self.solver.add_point(end_id, end_x, end_y)
        
        self.geometry_entities[geometry_id] = {
            'type': 'line',
            'start_point': start_id,
            'end_point': end_id,
        }
    
    def add_horizontal_line(
        self,
        geometry_id: str,
        start_x: float,
        y: float,
        length: float
    ):
        """Ajouter une ligne horizontale"""
        start_id = f"{geometry_id}_start"
        end_id = f"{geometry_id}_end"
        
        self.solver.add_point(start_id, start_x, y)
        self.solver.add_point(end_id, start_x + length, y)
        self.solver.add_horizontal_constraint(geometry_id, start_id, end_id)
        
        self.geometry_entities[geometry_id] = {
            'type': 'line',
            'start_point': start_id,
            'end_point': end_id,
            'horizontal': True,
        }
    
    def constrain_distance(
        self,
        constraint_id: str,
        entity1_id: str,
        entity2_id: str,
        distance: float
    ):
        """Ajouter contrainte de distance"""
        # Déterminer les points d'intersection
        geo1 = self.geometry_entities[entity1_id]
        geo2 = self.geometry_entities[entity2_id]
        
        if geo1['type'] == 'line' and geo2['type'] == 'line':
            # Distance entre les lignes
            self.solver.add_distance_constraint(
                constraint_id,
                geo1['start_point'],
                geo2['start_point'],
                distance
            )
    
    def solve(self) -> Tuple[bool, Dict[str, Tuple[float, float]]]:
        """Résoudre et retourner positions"""
        success = self.solver.solve()
        if success:
            positions = self.solver.get_all_positions()
            return success, positions
        else:
            return False, {}
```

---

## Opérations CAO modulaires

### Architecture modulaire extensible

```python
# cad_operations/base.py

from abc import ABC, abstractmethod
from typing import Dict, Optional, Any
import json

class CADOperation(ABC):
    """
    Classe de base pour toutes les opérations CAO
    Chaque opération est modulaire et traçable
    """
    
    # Metadata de l'opération
    operation_type: str  # 'pad', 'pocket', 'fillet', etc.
    display_name: str
    requires_sketch: bool  # Si elle a besoin d'un sketch
    requires_face: bool  # Si elle a besoin d'une face
    
    def __init__(self, name: str, parameters: Dict[str, Any]):
        self.name = name
        self.parameters = parameters
        self.geometry = None
        self.bounding_box = None
    
    @abstractmethod
    def validate(self) -> Tuple[bool, Optional[str]]:
        """Valider les paramètres"""
        pass
    
    @abstractmethod
    def execute(self, base_geometry) -> Any:
        """
        Exécuter l'opération sur la géométrie de base
        base_geometry: Previous operation result ou empty solid
        """
        pass
    
    @abstractmethod
    def to_dict(self) -> Dict:
        """Sérialiser pour stockage"""
        pass
    
    @staticmethod
    @abstractmethod
    def from_dict(data: Dict) -> 'CADOperation':
        """Désérialiser"""
        pass


# ============ OPERATIONS MODULAIRES ============

class PadOperation(CADOperation):
    """
    Extrusion (Pad)
    Extrude un sketch pour créer un solide
    """
    operation_type = 'pad'
    display_name = 'Pad (Extrude)'
    requires_sketch = True
    requires_face = False
    
    def __init__(
        self,
        name: str,
        sketch_id: UUID,
        depth: float,
        symmetric: bool = False,
        draft_angle: float = 0.0,
    ):
        super().__init__(name, {
            'sketch_id': sketch_id,
            'depth': depth,
            'symmetric': symmetric,
            'draft_angle': draft_angle,
        })
        self.sketch_id = sketch_id
        self.depth = depth
        self.symmetric = symmetric
        self.draft_angle = draft_angle
    
    def validate(self) -> Tuple[bool, Optional[str]]:
        """Valider Pad"""
        if not self.sketch_id:
            return False, "Sketch required"
        if self.depth <= 0:
            return False, "Depth must be positive"
        if abs(self.draft_angle) > 45:
            return False, "Draft angle must be between -45° and 45°"
        return True, None
    
    def execute(self, base_geometry) -> Any:
        """Exécuter Pad avec CadQuery"""
        try:
            # Récupérer le sketch depuis la BD
            sketch = Sketch.objects.get(id=self.sketch_id)
            wire = self._sketch_to_wire(sketch)
            
            # Créer workplane
            wp = cq.Workplane("XY").add(wire)
            
            # Appliquer extrusion
            if self.symmetric:
                result = wp.pad(self.depth / 2, taper=self.draft_angle)
                result = cq.Solid(result).moved(
                    cq.Vector(0, 0, -self.depth / 2)
                )
            else:
                result = wp.pad(self.depth, taper=self.draft_angle)
            
            self.geometry = result
            self._compute_bounding_box()
            return result
        
        except Exception as e:
            logger.error(f"Pad execution failed: {e}")
            raise
    
    def _sketch_to_wire(self, sketch: Sketch) -> Any:
        """Convertir données sketch en CadQuery Wire"""
        # À implémenter avec geometry_data du sketch
        pass
    
    def _compute_bounding_box(self):
        """Calculer bounding box"""
        if self.geometry:
            bb = self.geometry.val().BoundingBox()
            self.bounding_box = {
                'min': {'x': bb.xmin, 'y': bb.ymin, 'z': bb.zmin},
                'max': {'x': bb.xmax, 'y': bb.ymax, 'z': bb.zmax},
            }
    
    def to_dict(self) -> Dict:
        return {
            'operation_type': self.operation_type,
            'name': self.name,
            'sketch_id': str(self.sketch_id),
            'depth': self.depth,
            'symmetric': self.symmetric,
            'draft_angle': self.draft_angle,
        }
    
    @staticmethod
    def from_dict(data: Dict) -> 'PadOperation':
        return PadOperation(
            name=data['name'],
            sketch_id=UUID(data['sketch_id']),
            depth=data['depth'],
            symmetric=data.get('symmetric', False),
            draft_angle=data.get('draft_angle', 0.0),
        )


class PocketOperation(CADOperation):
    """
    Poche (enlèvement de matière)
    Soustrait un sketch extrude du solide actuel
    """
    operation_type = 'pocket'
    display_name = 'Pocket'
    requires_sketch = True
    requires_face = False
    
    def __init__(
        self,
        name: str,
        sketch_id: UUID,
        depth: float,
        through_all: bool = False,
    ):
        super().__init__(name, {
            'sketch_id': sketch_id,
            'depth': depth,
            'through_all': through_all,
        })
        self.sketch_id = sketch_id
        self.depth = depth
        self.through_all = through_all
    
    def validate(self) -> Tuple[bool, Optional[str]]:
        if not self.sketch_id:
            return False, "Sketch required"
        if not self.through_all and self.depth <= 0:
            return False, "Depth must be positive or use Through All"
        return True, None
    
    def execute(self, base_geometry) -> Any:
        """Exécuter Pocket"""
        try:
            if not base_geometry:
                raise ValueError("Pocket requires base geometry")
            
            sketch = Sketch.objects.get(id=self.sketch_id)
            wire = self._sketch_to_wire(sketch)
            
            wp = cq.Workplane("XY").add(base_geometry).add(wire)
            
            if self.through_all:
                result = wp.cutBlind(-self.depth, 1.0)  # Through all
            else:
                result = wp.cutBlind(-self.depth)
            
            self.geometry = result
            self._compute_bounding_box()
            return result
        
        except Exception as e:
            logger.error(f"Pocket execution failed: {e}")
            raise
    
    def _sketch_to_wire(self, sketch: Sketch):
        pass
    
    def _compute_bounding_box(self):
        if self.geometry:
            bb = self.geometry.val().BoundingBox()
            self.bounding_box = {
                'min': {'x': bb.xmin, 'y': bb.ymin, 'z': bb.zmin},
                'max': {'x': bb.xmax, 'y': bb.ymax, 'z': bb.zmax},
            }
    
    def to_dict(self) -> Dict:
        return {
            'operation_type': self.operation_type,
            'name': self.name,
            'sketch_id': str(self.sketch_id),
            'depth': self.depth,
            'through_all': self.through_all,
        }
    
    @staticmethod
    def from_dict(data: Dict) -> 'PocketOperation':
        return PocketOperation(
            name=data['name'],
            sketch_id=UUID(data['sketch_id']),
            depth=data['depth'],
            through_all=data.get('through_all', False),
        )


class FilletOperation(CADOperation):
    """
    Filetage (arrondir arêtes)
    """
    operation_type = 'fillet'
    display_name = 'Fillet'
    requires_sketch = False
    requires_face = False
    
    def __init__(
        self,
        name: str,
        radius: float,
        edge_ids: Optional[list[str]] = None,
    ):
        super().__init__(name, {
            'radius': radius,
            'edge_ids': edge_ids or [],
        })
        self.radius = radius
        self.edge_ids = edge_ids or []
    
    def validate(self) -> Tuple[bool, Optional[str]]:
        if self.radius <= 0:
            return False, "Radius must be positive"
        return True, None
    
    def execute(self, base_geometry) -> Any:
        """Exécuter Fillet"""
        try:
            if not base_geometry:
                raise ValueError("Fillet requires base geometry")
            
            wp = cq.Workplane("XY").add(base_geometry)
            
            if self.edge_ids:
                # Filet sur arêtes spécifiques
                for edge_id in self.edge_ids:
                    # Identifier et filéter l'arête
                    # À implémenter avec référence aux arêtes
                    pass
            else:
                # Filet sur toutes les arêtes
                result = wp.fillet(self.radius)
            
            self.geometry = result
            self._compute_bounding_box()
            return result
        
        except Exception as e:
            logger.error(f"Fillet execution failed: {e}")
            raise
    
    def _compute_bounding_box(self):
        if self.geometry:
            bb = self.geometry.val().BoundingBox()
            self.bounding_box = {
                'min': {'x': bb.xmin, 'y': bb.ymin, 'z': bb.zmin},
                'max': {'x': bb.xmax, 'y': bb.ymax, 'z': bb.zmax},
            }
    
    def to_dict(self) -> Dict:
        return {
            'operation_type': self.operation_type,
            'name': self.name,
            'radius': self.radius,
            'edge_ids': self.edge_ids,
        }
    
    @staticmethod
    def from_dict(data: Dict) -> 'FilletOperation':
        return FilletOperation(
            name=data['name'],
            radius=data['radius'],
            edge_ids=data.get('edge_ids'),
        )


# ============ OPERATION FACTORY ============

class OperationFactory:
    """Factory pattern pour créer opérations"""
    
    _operations = {
        'pad': PadOperation,
        'pocket': PocketOperation,
        'fillet': FilletOperation,
        # Extensible - ajouter de nouvelles opérations
    }
    
    @classmethod
    def create(cls, operation_type: str, **kwargs) -> CADOperation:
        """Créer une opération"""
        if operation_type not in cls._operations:
            raise ValueError(f"Unknown operation type: {operation_type}")
        return cls._operations[operation_type](**kwargs)
    
    @classmethod
    def from_dict(cls, data: Dict) -> CADOperation:
        """Créer depuis dict"""
        op_type = data['operation_type']
        operation_class = cls._operations.get(op_type)
        if not operation_class:
            raise ValueError(f"Unknown operation: {op_type}")
        return operation_class.from_dict(data)
    
    @classmethod
    def register(cls, operation_type: str, operation_class: type):
        """Enregistrer nouvelle opération (extensibilité)"""
        cls._operations[operation_type] = operation_class


# ============ OPERATION ENGINE ============

class PartCADEngine:
    """Moteur CAO pour construire une Part"""
    
    def __init__(self, part_id: UUID):
        self.part_id = part_id
        self.operations_list: List[CADOperation] = []
        self.current_solid = None  # État actuel géométrique
        self.operation_history = []
    
    def add_operation(self, operation: CADOperation) -> Tuple[bool, Optional[str]]:
        """Ajouter opération"""
        # Valider
        valid, error = operation.validate()
        if not valid:
            return False, error
        
        # Exécuter
        try:
            result = operation.execute(self.current_solid)
            self.operations_list.append(operation)
            self.current_solid = result
            self.operation_history.append({
                'operation_id': id(operation),
                'timestamp': datetime.now(timezone.utc),
            })
            return True, None
        except Exception as e:
            return False, str(e)
    
    def reorder_operations(self, new_order: List[int]):
        """Réordonner opérations et recalculer géométrie"""
        try:
            # Réordonner
            self.operations_list = [self.operations_list[i] for i in new_order]
            
            # Recalculer géométrie séquentielle
            self.current_solid = None
            for op in self.operations_list:
                result = op.execute(self.current_solid)
                self.current_solid = result
            
            return True, None
        except Exception as e:
            return False, str(e)
    
    def get_current_geometry(self):
        """Obtenir géométrie actuelle"""
        return self.current_solid
    
    def export_brep(self) -> Optional[bytes]:
        """Exporter en BREP (Open Cascade format)"""
        if not self.current_solid:
            return None
        try:
            from OCP.BRepTools import BRepTools
            from OCP.TCollection import TCollection_AsciiString
            
            writer = BRepTools()
            writer.Write_s(self.current_solid.val(), "temp.brep")
            with open("temp.brep", "rb") as f:
                return f.read()
        except:
            return None
```

---

## Flux de données complet

### Exemple détaillé: Créer un Pad simple

```
1. UTILISATEUR CRÉE SKETCH
   UI Client → envoi géométries + contraintes
   
2. SERVEUR REÇOIT ÉVÉNEMENT
   POST /api/sketches/{sketch_id}/geometry
   {
     "geometry_id": "line_1",
     "type": "line",
     "start": [0, 0],
     "end": [10, 0]
   }
   
3. VALIDATION & STORAGE
   - Valider data JSON
   - Créer GeometryAddedEvent
   - Émettre vers EventStore
   
4. EVENT STORE AJOUTE ÉVÉNEMENT
   INSERT INTO events (
     aggregate_id, event_type, data, ...
   ) VALUES (
     'sketch_xyz', 'sketch.geometry_added',
     '{geometry_id: "line_1", ...}',
     ...
   )
   
5. BROADCAST VERS CLIENTS
   - Envoyer via WebSocket à workspace
   - Autres clients UI mettent à jour
   
6. PROJECTION MISE À JOUR
   - SketchProjection recalculée
   - Cache Redis invalidé
   
7. UTILISATEUR AJOUTE CONTRAINTE
   UI Client → POST /api/sketches/{sketch_id}/constraints
   {
     "constraint_id": "const_1",
     "type": "distance",
     "variables": ["line_1", "line_2"],
     "value": 5.0
   }
   
8. CONSTRAINT SOLVER EXÉCUTÉ
   - Cassowary ajout contrainte
   - solver.solve()
   - Positions mises à jour
   
9. ÉVÉNEMENT ENREGISTRÉ
   INSERT INTO events (
     aggregate_id, event_type, data
   ) VALUES (
     'sketch_xyz', 'sketch.constraint_added',
     '{constraint_id: "const_1", ...}'
   )
   
10. UTILISATEUR CRÉE PAD
    UI Client → POST /api/parts/{part_id}/operations
    {
      "operation_type": "pad",
      "name": "Pad1",
      "sketch_id": "sketch_xyz",
      "depth": 10.0
    }
    
11. SERVEUR VALIDE & EXÉCUTE
    - PadOperation.validate() → OK
    - PadOperation.execute(base_geometry=None)
      - Récupère sketch_xyz depuis BD
      - Convertit geometry_data en CadQuery Wire
      - wp.pad(10.0) → crée solide
    - Calcule bounding box
    - Enregistre dans Operation table
    
12. ÉVÉNEMENT OPERATION_ADDED
    INSERT INTO events (
      aggregate_id, event_type, data
    ) VALUES (
      'part_xyz', 'part.operation_added',
      '{operation_id, name: "Pad1", ...}'
    )
    
13. GEOMETRY CACHE UPDATED
    - PartProjection reconstruite
    - current_geometry en JSON sérialisé
    - Stocké en cache Redis
    
14. BROADCAST 3D VIEW
    WebSocket → {
      "type": "geometry_updated",
      "part_id": "part_xyz",
      "geometry": "...BREP bytes...",
      "bounding_box": {...}
    }
    
15. CLIENT REÇOIT & AFFICHE
    - Three.js charger géométrie
    - Afficher dans viewer 3D
    - Mettre à jour tree (operations list)
    
UNDO/REDO FLOW:
- Utilisateur clique UNDO
- Client envoie WebSocket "undo" request
- Serveur pop() de UndoRedoStack[user][part]
- Récupère event_id de la pile
- Crée UndoEvent dans Event Store
- Reprojection depuis les événements non-annulés
- Broadcast nouvelle géométrie
- Redo stack push(event_id)
```

---

## Stack technique

### Architecture complète

```
┌──────────────────────────────────────────────────────────────┐
│                      CLIENT (Web)                            │
├──────────────────────────────────────────────────────────────┤
│ - Trame (Vue 3 + Python frontend)                            │
│ - Three.js / Babylon.js (3D Viewer)                          │
│ - Cassowary.js (Constraint solving en temps réel)            │
│ - Socket.io (WebSocket client)                               │
│ - JSON-RPC 2.0 (appels procédure distante)                   │
└────────────────┬─────────────────────────────────────────────┘
                 │ WebSocket (60fps min)
┌────────────────▼──────────────────────────────────────────────┐
│              Django + Channels Server                          │
├──────────────────────────────────────────────────────────────┤
│ - Django Rest Framework (API REST)                            │
│ - Django Channels (WebSocket + layer Redis)                   │
│ - Celery (Async jobs géométrie lourde)                        │
│ - Gunicorn/Uvicorn (ASGI server)                              │
│ - Serializers (DRF pour validation)                           │
│ - Middlewares (Auth, CORS, Throttling)                        │
└────────────────┬──────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────────────────────────────────┐
│            Application Layer (Django Apps)                     │
├──────────────────────────────────────────────────────────────┤
│ [auth_workspace]                                              │
│   - User authentication (JWT + Session)                       │
│   - Workspace management                                      │
│   - Collaboration permissions                                 │
│                                                               │
│ [projects]                                                    │
│   - Project CRUD                                              │
│   - Part management                                           │
│                                                               │
│ [sketcher]                                                    │
│   - Sketch creation/editing                                   │
│   - Constraint management                                     │
│   - SketchEngine (Cassowary integration)                       │
│                                                               │
│ [cad_operations]                                              │
│   - Operation CRUD                                            │
│   - PartCADEngine (CadQuery integration)                       │
│   - Geometry computation                                      │
│                                                               │
│ [assemblies]                                                  │
│   - Assembly CRUD                                             │
│   - Component placement                                       │
│   - Assembly constraints                                      │
│                                                               │
│ [events]                                                      │
│   - Event Store management                                    │
│   - Event publishing                                          │
│   - Projection/State rebuild                                  │
│   - Undo/Redo logic                                           │
│                                                               │
│ [collaboration]                                               │
│   - Lock management (distributed)                             │
│   - Live notifications                                        │
│   - Session tracking                                          │
└────────────────┬──────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────────────────────────────────┐
│           Data & Cache Layer                                  │
├──────────────────────────────────────────────────────────────┤
│ [PostgreSQL]                                                  │
│   - Workspace, Projects, Parts, Sketches                      │
│   - Operations, Assemblies                                    │
│   - Events (immutable append-only log)                        │
│   - Users, Sessions, Locks                                    │
│   - Indices critiques optimisés                               │
│                                                               │
│ [Redis]                                                       │
│   - Channels layer (message broadcasting)                     │
│   - Event cache (derniers 7 jours)                            │
│   - Lock store (pessimistic locking)                          │
│   - Session cache (WebSocket mappings)                        │
│   - Geometry cache (bounding boxes)                           │
│   - Rate limiting (throttling)                                │
└────────────────┬──────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────────────────────────────────┐
│        External Libraries Integration                          │
├──────────────────────────────────────────────────────────────┤
│ [CadQuery] (Geometry generation)                              │
│ [Cassowary] (Constraint solving)                              │
│ [OCP] (OpenCascade bindings)                                  │
│ [OCCUtils] (Open Cascade utilities)                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Plan d'implémentation

### Phase 1: Fondations (Semaines 1-4)
**Objectif**: Infrastructure de base fonctionnelle

- Semaine 1: Setup Django project
  - ✓ Créer Django project + apps
  - ✓ Configurer PostgreSQL + migrations
  - ✓ Django Rest Framework base
  - ✓ Authentication (JWT + Session)
  - Estimation: 3-4 jours

- Semaine 2: Event Sourcing architecture
  - ✓ Models Event, EventSnapshot
  - ✓ EventStore class (append-only)
  - ✓ Event broadcast via Redis Channels
  - ✓ Tests unitaires EventStore
  - Estimation: 4-5 jours

- Semaine 3: Sketcher foundation
  - ✓ Sketch model + serializers
  - ✓ Basic geometry types (point, line, arc)
  - ✓ Cassowary solver integration
  - ✓ REST API sketcher endpoints
  - Estimation: 4-5 jours

- Semaine 4: WebSocket integration
  - ✓ Channels setup + consumers
  - ✓ Workspace group broadcasting
  - ✓ Session management
  - ✓ Live geometry sync
  - Estimation: 3-4 jours

### Phase 2: CAO Core (Semaines 5-8)
**Objectif**: Moteur CAO fonctionnel avec Pad/Pocket

- Semaine 5: CadQuery integration
  - ✓ PartCADEngine class
  - ✓ PadOperation + PocketOperation
  - ✓ BREP export/import
  - ✓ Geometry computation async (Celery)
  - Estimation: 4-5 jours

- Semaine 6: Operation Management
  - ✓ Operation CRUD endpoints
  - ✓ Operation reordering (topology)
  - ✓ Geometry caching strategy
  - ✓ Edge/face identification
  - Estimation: 3-4 jours

- Semaine 7: Undo/Redo system
  - ✓ UndoRedoStack model
  - ✓ Undo/Redo event handlers
  - ✓ State reconstruction from events
  - ✓ Conflict resolution (multi-user)
  - Estimation: 4-5 jours

- Semaine 8: 3D Viewer integration
  - ✓ Trame 3D viewer component
  - ✓ Three.js geometry loading
  - ✓ Real-time updates
  - ✓ Interactive selection
  - Estimation: 3-4 jours

### Phase 3: Collaboration (Semaines 9-10)
**Objectif**: Multi-user synchronisation

- Semaine 9: Locking & Permissions
  - ✓ Distributed lock system (Redis)
  - ✓ Lock heartbeat mechanism
  - ✓ Permission checks per operation
  - ✓ Concurrent edit detection
  - Estimation: 4 jours

- Semaine 10: Live notifications
  - ✓ Notification model + delivery
  - ✓ User presence tracking
  - ✓ Activity feed
  - ✓ Conflict warnings
  - Estimation: 3 jours

### Phase 4: Assemblies (Semaines 11-12)
**Objectif**: Assemblages multi-pièces

- Semaine 11: Assembly structure
  - ✓ Assembly model + hierarchy
  - ✓ Component placement
  - ✓ Assembly constraints system
  - ✓ Assembly projection
  - Estimation: 4-5 jours

- Semaine 12: Assembly solving
  - ✓ Assembly constraint solver
  - ✓ Exploded view
  - ✓ BOX (Bill of Materials)
  - ✓ Assembly export (STEP)
  - Estimation: 3-4 jours

### Phase 5: Polish & Testing (Semaines 13-14)
**Objectif**: Production-ready

- Semaine 13: Testing
  - ✓ Unit tests (models, engines)
  - ✓ Integration tests (API)
  - ✓ E2E tests (Selenium)
  - ✓ Performance testing
  - Estimation: 4-5 jours

- Semaine 14: Optimization & Deployment
  - ✓ Database optimization
  - ✓ Query optimization
  - ✓ Cache strategy review
  - ✓ Docker containerization
  - ✓ Production deployment setup
  - Estimation: 3-4 jours

**TOTAL: 14 semaines (~3.5 mois)**

---

## Risques et points critiques

### 1. Risques techniques majeurs

#### A. Geometriy Complexity (CadQuery/OCP)
**Probabilité**: Moyenne | **Impact**: Critique

- **Problème**: CadQuery peut être instable avec géométries complexes
- **Symptômes**: Crashes OCP, topologie invalide, temps de calcul infini
- **Mitigation**:
  - Timeout strict sur opérations géométriques (max 30s)
  - Async Celery tasks avec limites mémoire
  - Validation BREP avant stockage
  - Fallback silencieux vers dernière géométrie valide
  - Tests intensifs avec 1000s de cas limites

#### B. Event Store Performance
**Probabilité**: Moyenne | **Impact**: Haute

- **Problème**: Millions d'événements = queries lentes
- **Symptômes**: Rechargement du sketch lent, projection timeout
- **Mitigation**:
  - Snapshots tous les 100 événements
  - Archivage événements vieux (>90 jours)
  - Partition table events par workspace
  - Index agressif (voir section BD)
  - Cache Redis des projections fréquentes

#### C. Cassowary Solver Infeasibility
**Probabilité**: Moyenne-Basse | **Impact**: Moyenne

- **Problème**: Utilisateur crée contraintes conflictuelles
- **Symptômes**: Solver retourne "infeasible", sketch bloqué
- **Mitigation**:
  - Weak constraints pour certains types
  - Détection automatique conflits
  - UI warning "conflicting constraints"
  - Capacité à annuler dernière contrainte
  - Capacité à relaxer certaines contraintes

#### D. WebSocket Scalability
**Probabilité**: Moyenne | **Impact**: Haute

- **Problème**: 100+ clients connectés, broadcast explosion
- **Symptômes**: Message queue overflow, lag significatif
- **Mitigation**:
  - Throttle événements (max 60Hz par client)
  - Compression payload (gzip WebSocket)
  - Selective broadcasting (seulement utilisateurs pertinents)
  - Redis streams pour ordering (au lieu de Pub/Sub)
  - Load balancing WebSocket sur plusieurs Uvicorn instances

#### E. Concurrency & Race Conditions
**Probabilité**: Basse | **Impact**: Critique

- **Problème**: Two users modify same sketch simultaneously
- **Symptômes**: Lost updates, incohérence données
- **Mitigation**:
  - Pessimistic locking (distributed locks)
  - Event versioning strict
  - Conflict detection au niveau événement
  - Operational Transformation (OT) pour certains opérations
  - Strong consistency checks au commit

### 2. Points critiques d'architecture

| Point | Criticité | Mitigation |
|-------|-----------|-----------|
| Event Store atomicité | **CRITIQUE** | Transaction PostgreSQL + sequence_number unique |
| Geometry computation timeout | **CRITIQUE** | Celery timeout + circuit breaker |
| Lock expiration | **Haute** | Heartbeat client + TTL Redis |
| Constraint solver stability | **Haute** | Validation input + exception handling |
| WebSocket ordering | **Haute** | Redis streams ordered delivery |
| Snapshot consistency | **Moyenne** | Version matching strict |

---

## Recommandations de dépendances

### Python Backend

```txt
# Core Framework
Django==4.2.*
djangorestframework==3.14.*
django-cors-headers==4.3.*
django-filter==23.5

# Async & WebSocket
channels==4.0.*
channels-redis==4.1.*
asgiref==3.8.*

# Database
psycopg2-binary==2.9.*  # PostgreSQL adapter
django-extensions==3.2  # Useful commands

# Caching
django-redis==5.4.*
redis==5.0.*

# Auth & Security
djangorestframework-simplejwt==5.3.*
django-cors-headers==4.3.*
cryptography==41.0.*

# Async Tasks
celery==5.3.*
celery-beat==2.5.*

# CAD Libraries (CRITICAL)
cadquery==2.4.*              # Main CAD kernel
ocp==7.7.2                   # OpenCascade bindings
cadquery-plugins==0.9.*      # Extensions

# Constraint Solving
cassowary==0.6.2             # Python implementation

# Geometry Export/Import
OCP-stubs==7.7.*

# Serialization
django-jsonfield==1.4.*
djangorestframework-dataclasses==1.3.*

# Validation
pydantic==2.4.*
marshmallow==3.20.*

# Testing
pytest==7.4.*
pytest-django==4.7.*
pytest-asyncio==0.21.*
factory-boy==3.3.*
faker==20.0.*

# Development
black==23.11.*
flake8==6.1.*
isort==5.12.*
mypy==1.7.*
django-debug-toolbar==4.2.*

# Production
gunicorn==21.2.*
whitenoise==6.6.*
sentry-sdk==1.38.*

# Utils
python-dateutil==2.8.*
pytz==2023.3.*
requests==2.31.*
```

### Frontend (Trame)

```javascript
// package.json

{
  "dependencies": {
    // Trame & Framework
    "trame": "^3.0.0",
    "trame-vuetify": "^3.0.0",
    "trame-components": "^3.0.0",
    
    // 3D Rendering
    "three": "^r157",
    "babylon.js": "^6.0.0",
    "three-csg-ts": "^3.0.0",
    
    // Constraint Solving (JS port)
    "cassowary": "^1.3.1",
    
    // WebSocket
    "socket.io-client": "^4.7.0",
    
    // State Management
    "pinia": "^2.1.0",
    
    // Utilities
    "lodash": "^4.17.21",
    "dayjs": "^1.11.0",
    "axios": "^1.6.0",
    
    // UI Components
    "vuetify": "^3.0.0",
    "vue-final-modal": "^4.5.0",
    
    // Utils
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    // Build tools (si Webpack)
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.0",
    
    // Testing
    "vitest": "^1.0.0",
    "cypress": "^13.6.0",
    
    // Linting
    "eslint": "^8.54.0",
    "prettier": "^3.1.0"
  }
}
```

### Infrastructure & DevOps

```yaml
# Docker
Docker 24.0+
Docker Compose 2.20+

# Deployment
Kubernetes 1.28+  (optional, pour production)
Helm 3.13+        (package management K8s)

# Database
PostgreSQL 15.1+
- Extensions: uuid-ossp, pg_trgm

# Cache/Queue
Redis 7.2+

# Monitoring
Prometheus 2.48+
Grafana 10.2+
ELK Stack (optional)

# CI/CD
GitHub Actions (ou GitLab CI)
Pre-commit hooks

# Documentation
Sphinx 7.2.6
mkdocs 1.5.3
```

---

## Recommandations finales

### 1. Architecture Decisions

✅ **Approches validées**:
- Event Sourcing pour immuabilité + undo/redo
- CQRS pour séparation lecture/écriture
- Pessimistic locking pour consistency
- Redis pour caching + broadcasting
- Cassowary pour constraint solving 2D
- CadQuery pour CAD operations

❌ **À éviter**:
- Operational Transformation (trop complexe pour CAO)
- NoSQL pour events (PostgreSQL meilleur)
- Real-time geometry computation (toujours async)
- Loose consistency model (CAD = données sensibles)

### 2. Priorities d'implémentation

1. **Phase 1-2** absolument essentielles (Event Store + Sketcher + Pad)
2. **Phase 3** nécessaire pour multi-user
3. **Phase 4** peut attendre (version 2.0)
4. **Phase 5** critique pour production

### 3. Points à surveiller

- **Geometrie OCP**: Envelopper tous les appels en try/catch + timeout
- **Event Store**: Absolutement append-only, jamais modifier
- **Cache invalidation**: Hard problem - utiliser versioning strict
- **WebSocket throughput**: Monitor + tune buffer sizes
- **Database indices**: CRITICAL - optimiser queries tôt

---

**Document généré le 2026-03-03**
**Durée estimée implémentation: 14 semaines**
**Équipe recommandée: 2-3 développeurs Python + 1 frontend**
