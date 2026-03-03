# CAO Web Application - Django Backend

Une application CAO web complète basée sur **Django + PostgreSQL + CadQuery + Trame**.

## 🎯 Vue d'ensemble

Architecture modulaire et extensible pour créer des géométries 3D à partir d'esquisses 2D:

```
Sketch 2D (Cassowary Solver)
    ↓
Extrude / Pocket / Fillet (CadQuery)
    ↓
Geometry 3D (STEP/STL)
    ↓
Assembly (Multi-pièces)
    ↓
Event Store (Undo/Redo)
```

## 📋 Fonctionnalités

### Phase 1 ✅ (Actuellement)
- [x] Modèles Django complets (9 models)
- [x] Event Sourcing avec ACID guarantees
- [x] API REST (JWT auth)
- [x] Multi-user + Project management
- [x] Migrations automatiques
- [x] Configuration PostgreSQL + Redis

### Phase 2 📝 (À venir)
- [ ] Sketcher 2D interactif (Canvas)
- [ ] Cassowary constraint solver
- [ ] CadQuery integration
- [ ] Extrude/Pocket operations
- [ ] 3D viewer (VTK.js)

### Phase 3-5
- [ ] Trame web interface
- [ ] WebSocket collaboration
- [ ] Advanced operations (Fillet, Thread)
- [ ] Tests & Optimizations

## 🚀 Démarrage rapide

### Installation

```bash
# 1. Créer PostgreSQL
createdb cao_db
createuser cao_user -P

# 2. Installer dépendances
cd cao_backend
source venv/bin/activate
pip install -r requirements.txt

# 3. Appliquer migrations
python manage.py migrate

# 4. Démarrer serveur
python manage.py runserver
```

### API Usage

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}' \
  | jq -r '.access')

# Create project
curl -X POST http://localhost:8000/api/projects/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My CAO Project"}'
```

## 📂 Structure

```
cao_backend/
├── cao_core/          # Core (Models + Event Store)
├── sketcher/          # 2D Sketcher
├── operations/        # CAD Operations
├── cao_config/        # Django Config
├── requirements.txt   # Dependencies
├── .env              # Environment vars
└── manage.py         # Django CLI
```

## 🛠️ Fichiers clés

| Fichier | Description |
|---------|-------------|
| `cao_core/models.py` | 9 modèles relationels |
| `cao_core/services.py` | Event Store service (ACID) |
| `cao_config/settings.py` | Configuration complète |
| `cao_core/urls.py` | API REST routing |

## 🔐 Authentification

- **JWT**: djangorestframework-simplejwt
- **Headers**: `Authorization: Bearer <token>`
- **Endpoints**: `/api/auth/token/`, `/api/auth/refresh/`

## 📊 Modèles

### Event Store (Event Sourcing)
```python
EventStore(
    project,
    event_type,       # 'sketch_created', 'geometry_extruded'
    event_number,     # Strict ordering
    payload,          # JSON event data
    aggregate_id,     # ID of affected entity
    aggregate_type,   # 'sketch', 'geometry', 'assembly'
    is_reverted,      # For undo tracking
)
```

### Project
```python
Project(
    owner,
    name,
    description,
    created_at,
    is_active,
)
```

### Sketch (2D)
```python
Sketch(
    project,
    name,
    geometry_data,    # JSON: points, lines, arcs
    constraints,      # JSON: Cassowary constraints
    is_valid,
    is_closed,
)
```

### Geometry (3D)
```python
Geometry(
    project,
    operation_type,   # 'extrude', 'pocket', 'fillet'
    base_sketch,
    parent_geometry,  # For dependent operations
    parameters,       # JSON: length, direction, etc
    step_file,        # 3D model file
    is_valid,
)
```

### Assembly
```python
Assembly(
    project,
    name,
    parts=[AssemblyPart],  # References to geometries
)
```

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/token/` | Get JWT token |
| GET/POST | `/api/projects/` | Project CRUD |
| GET/POST | `/api/sketches/` | Sketch CRUD |
| GET/POST | `/api/geometries/` | Geometry CRUD |
| GET/POST | `/api/assemblies/` | Assembly CRUD |
| POST | `/api/undo/` | Undo operation |
| POST | `/api/redo/` | Redo operation |
| GET | `/api/events/` | Event audit trail |

### Documentation

- **Swagger UI**: http://localhost:8000/api/docs/
- **Schema**: http://localhost:8000/api/schema/

## 🔄 Event Sourcing Workflow

```python
# 1. Append event (atomique)
EventStoreService.append_event(
    project=project,
    event_type='sketch_created',
    aggregate_id=sketch_id,
    aggregate_type='sketch',
    payload={'name': 'Sketch1', ...},
    actor=user
)

# 2. Replay events pour rebuild state
events = EventStoreService.get_aggregate_events(
    project=project,
    aggregate_id=sketch_id
)

# 3. Undo (mark events as reverted)
EventStoreService.undo_operation(project, undo_index=5)

# 4. Redo (unmark reverted)
EventStoreService.redo_operation(project, redo_index=5)
```

## 🐳 Docker (Optionnel)

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["gunicorn", "cao_config.wsgi:application", "--bind", "0.0.0.0:8000"]
```

## 📈 Performance

- **Database**: PostgreSQL + indexes sur event_number, aggregate_id
- **Caching**: Redis + django-redis
- **Async tasks**: Celery
- **Snapshots**: Créer snapshots tous les 100 événements

## 🔒 Security

- JWT authentication
- CORS configured
- CSRF protection
- SQL injection prevention (ORM)
- XSS prevention (JSON responses)

## 📝 Documentation

- `PHASE1_SUMMARY.md` - Résumé de la Phase 1
- `INSTALLATION.md` - Guide d'installation complet
- Architecture docs au parent: `/My Drive/CAO3/`

## 🐛 Support

Pour questions/bugs:
1. Vérifier `logs/cao.log`
2. Consulter `INSTALLATION.md` troubleshooting
3. Vérifier PostgreSQL/Redis sont actifs

## 📄 Licence

Propriétaire (CAO3 Project)

---

**Phase 1 Status**: ✅ COMPLÉTÉE  
**Dernière mise à jour**: 2026-03-03
