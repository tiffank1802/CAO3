# Résumé Exécutif et Diagrammes Techniques

## Résumé Exécutif

### Vision globale
Application CAO web modulaire, multi-utilisateur, temps réel avec:
- **Fondation**: Event Sourcing pour traçabilité + undo/redo natif
- **Sketcher 2D**: Cassowary solver pour contraintes automatiques
- **CAO 3D**: CadQuery/OpenCascade pour géométrie paramétrée
- **Collaboration**: WebSocket + Redis pour temps réel 100ms
- **Scalabilité**: Architecture microservices prête pour Kubernetes

### Metrics clés
| Métrique | Cible | Notes |
|----------|-------|-------|
| Latence UI → Serveur | < 200ms | WebSocket native |
| Geometry computation | < 30s | Async Celery + timeout |
| Event store throughput | 1000 evt/sec | PostgreSQL optimisée |
| Concurrent users | 100+ par workspace | Channels + load balancing |
| Data consistency | ACID | PostgreSQL SERIALIZABLE |
| Undo depth | illimité | Event sourcing |

### Points critiques d'architecture

```
Niveau CRITIQUE (bloquer sans ces éléments):
✓ Event Store atomique (PostgreSQL transaction SERIALIZABLE)
✓ Distributed lock system (Redis + heartbeat)
✓ Geometry computation timeout (Celery + circuit breaker)
✓ WebSocket message ordering (Redis streams)
✓ Cassowary constraint solver stability

Niveau HAUTE PRIORITÉ (v1.0):
✓ Multi-user sync (event broadcasting)
✓ Undo/Redo (event versioning)
✓ Assemblies basic (component hierarchy)

Niveau OPTIONNEL (v2.0):
- Advanced assembly constraints
- Parametric equations
- Cloud storage integration
- Mobile client
```

---

## Diagrammes Techniques Détaillés

### Diagramme 1: Architecture macroscopique

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER (Web)                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │  Sketcher UI     │  │  3D CAO Viewer   │  │  Assembly Tree   │ │
│  │                  │  │                  │  │                  │ │
│  │  - Canvas 2D     │  │  - Three.js      │  │  - Component     │ │
│  │  - Constraints   │  │  - BREP loader   │  │  - Drag-drop     │ │
│  │  - Cassowary.js  │  │  - Selection     │  │  - Constraints   │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│           │                    │                     │             │
│           └────────────────────┼─────────────────────┘             │
│                                │                                   │
│                        WebSocket (Socket.io)                       │
│                     JSON-RPC 2.0 messages                          │
│                     60fps update target                            │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │ NGINX Load Bal. │
                        └────────┬────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
┌───────▼────────┐      ┌───────▼────────┐      ┌───────▼────────┐
│  Uvicorn 1     │      │  Uvicorn 2     │      │  Uvicorn 3     │
│  (ASGI)        │      │  (ASGI)        │      │  (ASGI)        │
└───────┬────────┘      └───────┬────────┘      └───────┬────────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│                   APPLICATION LAYER (Django)                        │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ API REST Endpoints (DRF)                                  │    │
│  ├───────────────────────────────────────────────────────────┤    │
│  │ POST   /api/sketches               Create sketch          │    │
│  │ GET    /api/sketches/{id}          Fetch sketch           │    │
│  │ POST   /api/sketches/{id}/geometry Add geometry           │    │
│  │ POST   /api/sketches/{id}/constraints Add constraint      │    │
│  │ POST   /api/parts/{id}/operations  Create operation       │    │
│  │ POST   /api/parts/{id}/undo        Undo action            │    │
│  │ GET    /api/parts/{id}/geometry    Get 3D geometry        │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ WebSocket Consumers (Channels)                            │    │
│  ├───────────────────────────────────────────────────────────┤    │
│  │ /ws/workspace/{workspace_id}/                             │    │
│  │   - Handle: geometry.add                                  │    │
│  │   - Handle: constraint.add                                │    │
│  │   - Handle: operation.execute                             │    │
│  │   - Broadcast: event updates to group                     │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ Business Logic (Django Apps)                              │    │
│  ├───────────────────────────────────────────────────────────┤    │
│  │ [sketcher]        SketchEngine + Cassowary integration    │    │
│  │ [cad_operations]  PartCADEngine + CadQuery                │    │
│  │ [events]          EventStore + Projections                │    │
│  │ [collaboration]   Locking + Notifications                 │    │
│  │ [assemblies]      Component hierarchy + constraints       │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ Celery Tasks (Async jobs)                                 │    │
│  ├───────────────────────────────────────────────────────────┤    │
│  │ compute_pad_geometry()      (CadQuery heavy lifting)      │    │
│  │ compute_pocket_geometry()   (CadQuery heavy lifting)      │    │
│  │ rebuild_projection()        (Event replay)                │    │
│  │ export_to_step()            (CAD export)                  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                    │
└────────────────┬────────────────────────────┬───────────────────────┘
                 │                            │
        ┌────────▼────────┐        ┌──────────▼──────────┐
        │  PostgreSQL     │        │  Redis              │
        │  Event Store    │        │  (Cache + Channels) │
        └────────┬────────┘        └──────────┬──────────┘
                 │                            │
   ┌─────────────┼────────────────────────────┼──────────────┐
   │             │                            │              │
   ▼             ▼                            ▼              ▼
Events      Snapshots                   Pub/Sub Layer   Geometry Cache
Immutable   For optimization           Message Queue    Bounding boxes
Append-only                            Session store    Lock registry
```

### Diagramme 2: Séquence d'événement pour Créer un Pad

```
timing (ms)
0        ┌─ User clicks "Create Pad" button
         │
         ├─ UI Opens dialog
         │  └─ Selects Sketch S1, Depth = 10mm
         │
100      ├─ POST /api/parts/{part_id}/operations
         │  payload: {
         │    operation_type: "pad",
         │    sketch_id: "sketch_1",
         │    depth: 10.0,
         │    name: "Pad1"
         │  }
         │
200      │  Server receives request
         │  ├─ Validate parameters ✓
         │  ├─ Check sketch exists ✓
         │  └─ Create Operation model
         │
         │  EventStore.append_event({
         │    aggregate_id: part_id,
         │    event_type: "part.operation_added",
         │    data: {...}
         │  })
         │
250      │  ├─ DB transaction SERIALIZABLE
         │  ├─ SELECT MAX(seq_number) FOR UPDATE
         │  │  [seq = 143]
         │  │
         │  ├─ INSERT INTO events (seq=143, ...)
         │  │  returns event_id
         │  │
         │  ├─ Commit transaction ✓
         │  │
         │  └─ Cache: SET part:xyz:last_event event_id
         │
280      │  Redis.publish("workspace:xyz", {
         │    event_id: "ev_123",
         │    type: "part.operation_added",
         │    ...
         │  })
         │
300      │  Response 202 Accepted + job_id
         │  {"status": "computing", "job_id": "job_xyz"}
         │
         │  Client shows progress spinner
         │  Client starts polling GET /tasks/job_xyz
         │
330      │  Celery worker receives task
         │  compute_pad_geometry(part_id, operation_id)
         │
         │  ├─ Fetch Sketch geometry from cache
         │  │  └─ HIT: returns cached geometry_data
         │  │
         │  ├─ Convert to CadQuery Wire
         │  │
         │  ├─ wp = cq.Workplane("XY").add(wire)
         │  │
         │  ├─ result = wp.pad(10.0)
         │  │
         │  ├─ Serialize to BREP
         │  │  └─ ~100KB file
         │  │
         │  └─ Compute bounding box
         │
450      │  Store result in cache
         │  SET geo:part:xyz BREP_bytes
         │  EXPIRE 3600
         │
500      │  Update Operation model
         │  ├─ computed_geometry = BREP_bytes
         │  ├─ bounding_box = {min, max}
         │  └─ status = "completed"
         │
         │  Emit event: "part.operation_computed"
         │  ├─ INSERT INTO events
         │  └─ Redis.publish broadcast
         │
550      │  WebSocket message to client
         │  {
         │    type: "operation_computed",
         │    operation_id: "op_xyz",
         │    geometry_url: "/download/geometry/op_xyz",
         │    bbox: {...}
         │  }
         │
600      │  Client receives WebSocket message
         │  ├─ Removes spinner
         │  ├─ Fetches geometry from URL (GETrequest)
         │  └─ Renders in Three.js
         │
700      └─ User sees Pad displayed in 3D viewer
           Total end-to-end: ~700ms
           (Most time on geometry computation: 200-400ms)
```

### Diagramme 3: State Machine pour Part

```
                        ┌─────────────────────────────────┐
                        │   PART STATE MACHINE            │
                        └──────────────┬──────────────────┘
                                       │
                            [CREATED via event]
                                       │
                           ┌───────────▼──────────┐
                           │   EMPTY_SOLID        │
                           │                      │
                           │ operations: []       │
                           │ geometry: None       │
                           │ events: [created]    │
                           └───────────┬──────────┘
                                       │
                    [operation_added: Pad1]
                                       │
                           ┌───────────▼──────────┐
                           │   WITH_PAD           │
                           │                      │
                           │ ops: [Pad1]          │
                           │ geo: Solid           │
                           │ bbox: {...}          │
                           └──────┬────────┬──────┘
                                  │        │
                  [operation_added │        │ [operation_deleted: Pad1]
                    Pocket1]       │        │
                                  │        │
                           ┌───────▼────┐  │
                           │ WITH_PAD   │  │
                           │ AND_POCKET │  │
                           │            │  │
                           │ ops: [P,P] │  │
                           │ geo: Solid │  │
                           └───────┬────┘  │
                                   │       │
                    [operation_added│       │
                      Fillet1]      │       │
                                   │       │
                           ┌───────▼────┐  │
                           │ WITH_PAD   │  │
                           │ POCKET     │  │
                           │ FILLET     │  │
                           │            │  │
                           │ ops: [P,P,F]  │
                           │ geo: Solid │  │
                           └───────┬────┘  │
                                   │       │
               [operation_reordered]       │
                           │       │       │
                    ┌──────┘       │       │
                    │              │       │
              (same state,          │       │
              different order)      │       │
                                   │       │
                                   │◄──────┘ [delete]
                                   │
                           ┌───────▼──────────┐
                           │   EMPTY_SOLID    │
                           │ (rolled back)    │
                           └──────────────────┘

EVENTS STORED:
[part_created] →
  [operation_added: Pad1] →
  [operation_added: Pocket1] →
  [operation_added: Fillet1] →
  [operation_reordered] →
  [operation_deleted: Fillet1] →
  [operation_deleted: Pocket1]

If UNDO triggered after Fillet1:
  Replay events: [part_created, op_added:Pad1, op_added:Pocket1]
  Skip: [operation_added: Fillet1]
  Result: Back to "WITH_PAD_AND_POCKET" state
```

### Diagramme 4: Lock Distribution

```
User1 (Session A)        User2 (Session B)       Lock Manager        Redis
│                        │                       (Django)             │
├─ Open Sketch S1        │                                            │
│                        │                                            │
├─ POST /sketches/S1     │                                            │
│  "Get lock"            │                                            │
│  ────────────────────────────────────────────────────────────────► │
│                        │                                            │ SETNX lock:sketch:S1 {
│                        │                        ◄────────────────── │  user: user1,
│                        │                        │                  │  session: sess_a,
│                        │                        │ Lock acquired    │  expires: T+5min
│                        │                        │ + send webhook   │ }
│                        │                        │                  │
│                        │                        ├─ Broadcast event │
│                        │                        │  "lock_acquired" │
│                        │                        │  user1 locked S1 │
│                        │                        │                  │
│ ◄─ WebSocket msg       │                        │                  │
│  "lock_acquired"       │                        │                  │
│  (user1 locked it)     │                        │                  │
│                        │                        │                  │
│ ◄─ 200 OK              │                        │                  │
│  lock_token: "tok_a"   │                        │                  │
│                        │                        │                  │
│  Now editing...        │                        │                  │
│  ├─ Add geometry       │                        │                  │
│  └─ heartbeat every 1s │                        │                  │
│     ────────────────────────────────────────────────► EXPIRE   │
│                        │                        │  lock:sketch:S1  │
│                        │                        │  +60sec (refresh)│
│                        │                        │                  │
│                        ├─ Open Sketch S1        │                  │
│                        │                        │                  │
│                        ├─ POST /sketches/S1     │                  │
│                        │  "Get lock"            │                  │
│                        │  ───────────────────────────────────────► │
│                        │                        │                  │ SETNX lock:sketch:S1
│                        │                        │                  │ ALREADY_EXISTS
│                        │                        │  ◄──────────────│
│                        │                        │  Lock denied     │
│                        │                        │  Returns owner   │
│                        │                        │  (user1)         │
│                        │                        │                  │
│                        │ ◄─ WebSocket msg       │                  │
│                        │  "lock_unavailable"    │                  │
│                        │  locked_by: "user1"    │                  │
│                        │  expires_in: 45sec     │                  │
│                        │                        │                  │
│                        │ ◄─ 423 Locked          │                  │
│                        │  (read-only mode)      │                  │
│                        │                        │                  │
│ ├─ Finishes editing    │                        │                  │
│ │                      │                        │                  │
│ └─ POST /unlock        │                        │                  │
│    lock_token: "tok_a" │                        │                  │
│    ─────────────────────────────────────────────────────────────► │
│                        │                        │                  │ DEL lock:sketch:S1
│                        │                        │  ◄──────────────│
│                        │                        │  Deleted         │
│                        │                        │                  │
│                        │                        ├─ Broadcast event│
│                        │                        │  "lock_released" │
│                        │                        │                  │
│ ◄─ WebSocket msg       │                        │                  │
│  "lock_released"       │                        │                  │
│                        ├─ lock available ◄──────────────────────────│
│                        │  POST /lock            │                  │
│                        │  ─────────────────────────────────────────► SETNX
│                        │                        │                  │
│                        │ ◄─ 200 OK              │                  │
│                        │  lock acquired         │  ◄──────────────│
│                        │  lock_token: "tok_b"   │                  │
│                        │                        │                  │
│                        │ Now editing in RW mode │                  │
│                        │                        │                  │

TIMEOUT SCENARIO:
User1 crashes without unlock:
   T+5min: lock expires in Redis
   T+5min: Next user who checks → lock unavailable → GET info
   T+5min: Old lock gone, new user can acquire
```

---

## Recommandations Finales

### 1. Priorisation des risques

```
┌─────────────────────────────────────────────────────────────┐
│ MATRICE RISQUES                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ CRITICAL (Must solve before v1.0)                           │
│ ├─ Geometry computation crashes → Timeout + Fallback       │
│ ├─ Event Store corruption → Transactional atomicity        │
│ ├─ Lock deadlock → Heartbeat + TTL                         │
│ └─ WebSocket message loss → Redis ordering                 │
│                                                             │
│ HIGH (Should solve)                                         │
│ ├─ Cassowary infeasibility → Constraint relaxation UI      │
│ ├─ Database performance → Aggressive indexing              │
│ ├─ Cache invalidation issues → Event-driven strategy       │
│ └─ User concurrent edits → Last-write-wins + merge         │
│                                                             │
│ MEDIUM (Nice to have)                                       │
│ ├─ Memory leaks in long sessions → Monitoring + alerts     │
│ ├─ Slow client handshake → Session caching                 │
│ └─ Geometry export errors → Try multiple formats           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Checklist avant Production

```
DATABASE
☐ PostgreSQL 15+ configured
☐ All indices created (see ARCHITECTURE.md)
☐ Vacuum strategy set (daily)
☐ Backups every 6 hours
☐ SERIALIZABLE isolation level tests
☐ Connection pooling tuned (PgBouncer)

REDIS
☐ Redis 7+ cluster mode if > 100 users
☐ Persistence enabled (AOF)
☐ Memory limits set (maxmemory-policy allkeys-lru)
☐ Backups every 6 hours
☐ Sentinel for HA

DJANGO APPLICATION
☐ SECRET_KEY from environment
☐ DEBUG = False
☐ ALLOWED_HOSTS configured
☐ CSRF/CORS whitelist set
☐ Sentry integration (error tracking)
☐ Rate limiting enabled
☐ Static files collected

SECURITY
☐ HTTPS everywhere
☐ JWT token expiration set
☐ CORS headers restricted
☐ SQL injection tests passed
☐ XSS protection enabled
☐ CSRF protection working

PERFORMANCE
☐ Database queries optimized (< 100ms)
☐ Cache hit rate > 80%
☐ WebSocket latency < 200ms
☐ Geometry computation < 30s
☐ Load testing passed (100+ concurrent)

MONITORING
☐ Log aggregation (ELK Stack)
☐ Metrics collection (Prometheus)
☐ Alerting configured (Grafana)
☐ Uptime monitoring (Datadog/New Relic)
☐ Error rate tracking
☐ User session monitoring

DEPLOYMENT
☐ Docker images built
☐ Kubernetes manifests written
☐ Helm charts created
☐ Blue-green deployment tested
☐ Rollback procedure documented
☐ Disaster recovery tested
```

### 3. Dépendances critiques (versions minimum)

```python
# CORE
Django>=4.2.0           # LTS support until April 2026
PostgreSQL>=15.0        # Features + performance
Redis>=7.0             # Streams ordering

# CAD
CadQuery>=2.4          # Latest stable
OCP>=7.7.2             # OpenCascade 7.7

# Constraint Solving
cassowary>=0.6.2       # Python implementation stable

# REST API
djangorestframework>=3.14    # Latest stable
channels>=4.0               # ASGI + WebSocket

# Testing
pytest>=7.4
pytest-django>=4.7
factory-boy>=3.3       # Test fixtures

# Production
gunicorn>=21.2
django-redis>=5.4
sentry-sdk>=1.38

# Dev
black>=23.11           # Code formatting
mypy>=1.7             # Type checking
```

### 4. Timeline révisée (avec dépendances)

```
SEMAINE 1-2: Foundation (Django + DB + Auth)
├─ Setup project structure
├─ PostgreSQL schema design
├─ Django models + migrations
├─ JWT authentication
└─ Docker local development

SEMAINE 3-4: Event Sourcing
├─ Event Store implementation
├─ Append-only guarantees
├─ Redis broadcasting
├─ Snapshot strategy
└─ Unit tests

SEMAINE 5-6: Sketcher
├─ Cassowary integration
├─ 2D geometry types
├─ Constraint solving
├─ WebSocket sync
└─ Integration tests

SEMAINE 7-8: CAO Operations
├─ CadQuery integration
├─ Pad + Pocket operations
├─ Celery async compute
├─ BREP caching
└─ Performance tuning

SEMAINE 9-10: Collaboration
├─ Distributed locks
├─ User permissions
├─ Live notifications
├─ Conflict detection
└─ E2E tests

SEMAINE 11-12: Assemblies
├─ Component hierarchy
├─ Assembly constraints
├─ Multi-part loading
└─ Assembly export

SEMAINE 13-14: Polish
├─ Performance optimization
├─ Security hardening
├─ Documentation
├─ Deployment setup
└─ Production testing

BUFFER: 1-2 weeks pour imprévus
TOTAL: 4 months (1 team de 2-3 dev)
```

---

## Questions clés à valider avec stakeholders

1. **Offline editing**: Supporter l'édition hors-ligne avec sync later?
   - Adds: Conflict resolution complexity, state reconciliation
   - Impact: +2-3 weeks

2. **Version history**: Garder l'historique complet (ne pas archiver)?
   - Adds: Storage costs (exponential with usage)
   - Impact: +0 weeks (Event Store inclut)

3. **Real-time quotas**: Limiter utilisateurs simultanés par workspace?
   - Adds: Queue management, waiting list UI
   - Impact: +1 week

4. **Assembly visualization**: Exploded view + animation?
   - Adds: Animation engine, state management
   - Impact: +2-3 weeks

5. **Mobile client**: Support iOS/Android?
   - Adds: React Native + separate sync protocol
   - Impact: +6-8 weeks

6. **On-premise vs SaaS**: Architecture multi-tenant?
   - Adds: Data isolation, license management
   - Impact: +3-4 weeks

---

**Fin du résumé exécutif et diagrammes techniques**

---

## Appendix A: Commandes d'initialisation

### Setup local development

```bash
# 1. Clone et setup
git clone <repo>
cd cao3_project
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Database
docker run -d -p 5432:5432 \
  -e POSTGRES_DB=cao3_db \
  -e POSTGRES_USER=cao3_user \
  -e POSTGRES_PASSWORD=password \
  postgres:15-alpine

# 3. Redis
docker run -d -p 6379:6379 \
  -p 6380:6380 \
  redis:7-alpine \
  redis-server

# 4. Migrations
python manage.py makemigrations
python manage.py migrate

# 5. Create superuser
python manage.py createsuperuser

# 6. Collect static
python manage.py collectstatic --noinput

# 7. Run Celery worker
celery -A cao3_project worker -l info --concurrency=4

# 8. Run server
python manage.py runserver

# 9. Run Daphne (ASGI)
daphne -b 0.0.0.0 -p 8000 cao3_project.asgi:application
```

### Test commands

```bash
# Unit tests
pytest tests/ -v

# Coverage
pytest tests/ --cov=. --cov-report=html

# Integration tests
pytest tests/integration -v -s

# Load testing (Locust)
locust -f tests/load/locustfile.py -H http://localhost:8000

# Database optimization
python manage.py sqlsequencereset --app=events | psql
ANALYZE;
REINDEX;
```

---

**Document généré: 2026-03-03**
**Pour questions: voir ARCHITECTURE.md et IMPLEMENTATION_DETAILS.md**
