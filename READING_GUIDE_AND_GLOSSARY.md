# Guide de Lecture et Glossaire Technique

## Guide de Lecture des Documents

### Pour qui lit quoi?

```
📋 PROJET MANAGER / STAKEHOLDER
├─ Lire: EXECUTIVE_SUMMARY.md
├─ Sections clés:
│  ├─ Résumé exécutif (Vue globale)
│  ├─ Metrics clés (Cibles de performance)
│  ├─ Timeline (4 mois pour v1.0)
│  ├─ Questions clés (Validation requirements)
│  └─ Checklist production
└─ Temps: 30-45 min

👨‍💻 ARCHITECTE SYSTÈME
├─ Lire TOUS les documents
├─ Focus: ARCHITECTURE.md
├─ Sections clés:
│  ├─ Vue d'ensemble (flux applicatif)
│  ├─ Schéma de données (Django models)
│  ├─ System d'événements (Event Sourcing)
│  ├─ Stack technique (infra)
│  ├─ Plan d'implémentation (phases)
│  └─ Risques identifiés
└─ Temps: 2-3 heures

🔧 DÉVELOPPEUR BACKEND
├─ Lire: ARCHITECTURE.md + IMPLEMENTATION_DETAILS.md
├─ Focus: 
│  ├─ Système d'événements détaillé
│  ├─ Code examples (EventStore, SketchEngine)
│  ├─ Configuration Django (settings.py)
│  ├─ Stratégie de cache
│  └─ Tests patterns
└─ Temps: 1.5 heures par section

🎨 DÉVELOPPEUR FRONTEND
├─ Lire: EXECUTIVE_SUMMARY.md (diagrammes)
├─ Focus:
│  ├─ Architecture macroscopique
│  ├─ WebSocket consumers
│  ├─ Flux de données complet (exemple Pad)
│  └─ Cache strategy
└─ Temps: 1 heure

🧪 QA / TEST ENGINEER
├─ Lire: EXECUTIVE_SUMMARY.md + Tests section IMPLEMENTATION_DETAILS.md
├─ Focus:
│  ├─ Checklist avant production
│  ├─ Critical paths (Event Store, locks)
│  ├─ Load testing strategy
│  └─ Concurrency scenarios
└─ Temps: 1 heure

🏗️ DEVOPS / INFRA
├─ Lire: EXECUTIVE_SUMMARY.md + settings.py
├─ Focus:
│  ├─ Stack technique (Docker, K8s)
│  ├─ Configuration Django
│  ├─ Monitoring setup
│  └─ Deployment checklist
└─ Temps: 45 min
```

---

## Glossaire Technique

### A

**Agrégat** (Aggregate)
- Entité de domaine groupant données liées (ex: Sketch = géométries + contraintes)
- Pattern DDD (Domain-Driven Design)
- Root pour Event Sourcing

**ACID**
- Atomicité, Cohérence, Isolation, Durabilité
- Garanties transactionnelles PostgreSQL

**ASGI** (Asynchronous Server Gateway Interface)
- Standard Python pour serveurs async
- Implémentation: Daphne, Uvicorn
- Nécessaire pour WebSocket et Channels

**Append-only**
- Structure de données immuable, seulement INSERT
- Pattern Event Store
- Garantit traçabilité complète

### B

**BREP** (Boundary Representation)
- Format géométrie: surface fermée définit solide
- OCP/OpenCascade format natif
- Utilisé pour caching géométrie

**Bounding Box** (BBox)
- Rectangle 3D englobant d'un objet
- Utile pour culling/collision detection

### C

**CadQuery**
- Wrapper Python autour OpenCascade (OCP)
- API fluide pour programmation CAO
- Exécution: `.val()` retourne OCP handle

**Cassowary Solver**
- Constraint solving library (Java origin, Python port)
- Incrémental et temps réel
- Utilité: Sketcher 2D constraints

**Channels** (Django Channels)
- Django extension pour WebSocket + async
- Utilise Redis layer pour pub/sub
- Consumer = WebSocket handler

**CQRS** (Command Query Responsibility Segregation)
- Séparer modèle écriture (Commands) et lecture (Queries)
- Lecture via projections (optimisées)
- Écriture via events

**Constraints**
- Règles géométriques (distance, coincidence, horizontal, etc)
- Sketch: résolues par Cassowary
- Assembly: résolution analytique

### D

**DDD** (Domain-Driven Design)
- Modélisation métier centrée domaine
- Agrégats, Events, Value Objects
- Used in: Event Sourcing architecture

**Daphne**
- ASGI HTTP + WebSocket server
- Alternative à Gunicorn/Uvicorn

**Django REST Framework** (DRF)
- Framework REST sur Django
- Serializers, Viewsets, Permissions
- Used for: API HTTP endpoints

### E

**Event Sourcing**
- Persistance basée événements
- Stocker deltas au lieu états
- Bénéfices: Undo/Redo, audit trail, replay

**Event Store**
- BD centrale pour événements immutables
- Pattern: append-only PostgreSQL table
- Avec snapshots pour optimization

### F

**FIFO** (First In First Out)
- Ordre garantissant Redis Streams

**Fixture**
- Test data (factory-boy)

### G

**Geometry**
- Représentation 3D (solides, surfaces)
- Sérialisée: BREP bytes
- Cachée: Redis + PostgreSQL

**Gunicorn**
- WSGI application server
- Préféré pour production HTTP

### H

**Heartbeat**
- Ping régulier pour vérifier connexion
- Locks: heartbeat = refresh TTL
- WebSocket: keep-alive

**HTTP/2**
- Multiplexing, compression
- Migration future de HTTP/1.1

### I

**Isolation Level** (PostgreSQL)
- READ_UNCOMMITTED, READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
- Choix ARCHITECTURE: SERIALIZABLE pour Event Store

**Index** (Database)
- Structure pour requêtes rapides
- CRITICAL: créer sur aggregate_id, workspace_id, timestamp

### J

**JSON-RPC 2.0**
- Standard pour appels procédure distante
- Format: `{"jsonrpc": "2.0", "method": "...", "params": {}, "id": 1}`

**JWT** (JSON Web Token)
- Authentification stateless
- Token = signature de claims (user_id, exp, etc)

### K

**Kubernetes** (K8s)
- Orchestration conteneurs
- Déploiement: À partir v2.0

### L

**Lock** (Distributed Lock)
- Exclusion mutuelle pour ressources partagées
- Implementation: Redis SETNX + TTL
- Pessimistic locking strategy

**Latency**
- Délai réponse (ms)
- Target: < 200ms WebSocket

### M

**Middleware**
- Fonction interceptant requêtes/réponses
- Django: CORS, Auth, Security

**Multi-tenant**
- Plusieurs organisations/workspaces
- Isolation données per tenant
- Future: v2.0

### N

**Notification**
- Message temps réel vers utilisateur
- WebSocket broadcast
- Types: user_joined, lock_released, error

**Normalization** (Database)
- Éliminer redondance données
- Normal forms: 1NF, 2NF, 3NF, BCNF
- Utilisé pour schema ARCHITECTURE

### O

**OCP** (OpenCascade Python)
- Python bindings pour OpenCascade library
- Classe fondamentales: TopoDS_Shape, etc
- Via CadQuery abstraction

**Optimization** (Database)
- EXPLAIN ANALYZE pour requêtes
- Index creation, query rewrite
- Query planner tuning

**Operational Transformation** (OT)
- Algorithme résolution conflits temps réel
- Alternative CRDT, Vs Event Sourcing
- Not chosen: trop complexe pour CAO

### P

**Partition** (Table)
- Diviser grand table en petites
- PostgreSQL: range, list, hash partitioning
- events table: partition par workspace

**Projection** (CQRS)
- Vue optimisée pour lecteur (read model)
- Recalculée depuis événements
- Cachée pour performance

**Pessimistic Locking**
- Acquérir lock AVANT modifier
- Vs optimistic: assume pas de conflit
- Chosen for CAO: consistency

### Q

**Queue** (Message Queue)
- FIFO list (Redis, RabbitMQ, SQS)
- Utilisé: Celery task queue
- Pub/Sub: Channels layer

### R

**Redis**
- In-memory data store
- Utilisé pour: cache, pub/sub, locks, sessions
- Channels: Redis layers for group messaging

**RDBMS** (Relational Database Management System)
- PostgreSQL
- Transactions ACID, complex queries

**Replication** (Database)
- Copie de données vers replica server
- Lecture depuis replica (scaling)
- HA: Primary failover automatique

**Replay** (Event)
- Reconstruction état depuis événements
- Pattern: event log playback
- Usage: Undo/Redo, snapshot validation

### S

**Serializable** (Isolation Level)
- Strictest isolation
- Transactions sérialisées (no concurrency anomalies)
- Trade-off: Performance hit
- Choix ARCHITECTURE pour consistency critique

**Session**
- Connexion utilisateur
- Model: stores WebSocket channel_name, user_id
- TTL: expire si inactif

**Snapshot** (Event Store)
- État complet à version N
- Optimization: avoid replaying 1000s events
- Strategy: tous les 100 événements

**Solver** (Constraint Solver)
- Résout système contraintes
- Cassowary: incremental, graphical constraints
- Alternatives: Z3, CVC, Gurobi (optimization)

**SQL Injection**
- Faille sécurité: concaténer SQL avec user input
- Prévention: parameterized queries (Django ORM)

### T

**Throughput**
- Nombre opérations par unité temps
- Target Event Store: 1000 events/sec

**TTL** (Time To Live)
- Expiration de cache/lock
- Redis: EXPIRE key 3600 (1 heure)

**Topology** (Geometry)
- Relations entre faces, edges, vertices
- Important pour sélection, fillets

**Transaction**
- Groupe opérations atomiques
- ACID: commit ou rollback
- PostgreSQL: BEGIN, COMMIT, ROLLBACK

### U

**Undo/Redo**
- Annuler/Refaire action
- Implementation: UndoRedoStack + events
- Très simple avec Event Sourcing

**Uvicorn**
- ASGI HTTP + WebSocket server
- Pur Python, async/await
- Alternatif Daphne

### V

**Value Object** (DDD)
- Objet sans identité (immutable)
- Ex: Coordinate(x=10, y=20)
- Vs Entity: a identity (Sketch, Part)

**Versioning**
- Numéro version pour coherence checking
- Event.version = version agrégat à cet événement
- Snapshot.version = à quel état reconstruit

**Viewport**
- Zone affichage écran (client-side)
- 3D Viewport: Three.js rendering context

### W

**WebSocket**
- Protocole full-duplex sur TCP
- Latency: ~10-50ms (vs HTTP polling: 100-1000ms)
- Implementation: Socket.io, Django Channels

**Workbench** (CAO)
- Workspace utilisateur
- Model: Workspace -> Projects -> Parts -> Sketches

### X, Y, Z

**XY Plane**
- Plan 2D horizontal (Z=0)
- Sketch default orientation

**Zero-downtime Deployment**
- Blue-green ou canary deployment
- Users don't see downtime

---

## Matrices de Décision

### Event Sourcing vs Alternative

```
┌────────────────────────────────────────────────────────────┐
│ COMPARAISON PATTERNS PERSISTANCE                           │
├─────────────────────┬──────────┬──────────┬──────────┬──────┤
│ Critère             │Event     │CRUD      │CQRS      │CRDT  │
│                     │Sourcing  │Classique │(Hybrid)  │      │
├─────────────────────┼──────────┼──────────┼──────────┼──────┤
│ Undo/Redo           │ ⭐⭐⭐⭐⭐ │ ⭐⭐     │ ⭐⭐⭐⭐  │ ⭐⭐  │
│ Audit trail         │ ⭐⭐⭐⭐⭐ │ ⭐⭐     │ ⭐⭐⭐⭐  │ ⭐⭐⭐ │
│ Collaboration time  │ ⭐⭐⭐⭐  │ ⭐      │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐ │
│ Consistency         │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐   │ ⭐⭐  │
│ Performance read    │ ⭐⭐     │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐ │
│ Performance write   │ ⭐⭐⭐⭐  │ ⭐⭐⭐⭐  │ ⭐⭐⭐⭐  │ ⭐⭐⭐ │
│ Complexity impl     │ ⭐⭐     │ ⭐⭐⭐⭐⭐ │ ⭐⭐     │ ⭐    │
│ Learning curve      │ ⭐⭐     │ ⭐⭐⭐⭐⭐ │ ⭐⭐⭐   │ ⭐    │
└─────────────────────┴──────────┴──────────┴──────────┴──────┘

CHOIX: Event Sourcing
RAISON: Undo/Redo essentiels + audit trail + consistency
```

### Lock Strategy Comparison

```
┌──────────────────────────────────────────────────────┐
│ STRATÉGIES LOCKING                                   │
├──────────────────┬───────────┬──────────┬───────────┤
│ Critère          │Pessimistic│Optimistic│Hybrid     │
├──────────────────┼───────────┼──────────┼───────────┤
│ Latency          │ Basse     │ Basse    │ Moyenne   │
│ Conflict rate    │ Zéro      │ Élevé    │ Bas       │
│ Complexity       │ Haute     │ Basse    │ Moyenne   │
│ Scalability      │ Faible    │ Forte    │ Bonne     │
│ User experience  │ Bloquant  │ Optimiste│ Équilibré │
└──────────────────┴───────────┴──────────┴───────────┘

CHOIX: Pessimistic (avec timeout)
RAISON: CAO = structure sensible, mieux bloquer que fusionner
```

### Constraint Solver Comparison

```
┌──────────────────────────────────────────────┐
│ CONSTRAINT SOLVERS POUR SKETCHER             │
├──────────────┬───────────┬─────────┬────────┤
│ Critère      │Cassowary  │Z3       │Gurobi  │
├──────────────┼───────────┼─────────┼────────┤
│ Speed 2D     │ ⭐⭐⭐⭐⭐ │ ⭐⭐    │ ⭐⭐   │
│ Incremental  │ ⭐⭐⭐⭐⭐ │ ⭐⭐    │ ⭐⭐   │
│ Python port  │ ⭐⭐⭐⭐  │ ⭐⭐⭐  │ ⭐⭐   │
│ License      │ Open      │ Open    │ Comm   │
│ Docs         │ Bon       │ Excellent│ Bon    │
└──────────────┴───────────┴─────────┴────────┘

CHOIX: Cassowary
RAISON: Designed pour graphical constraints 2D, performant
```

---

## Checklist d'Audit Architecture

### ✅ Fonctionnalités essentielles

- [ ] Event Store atomique
  - [ ] Append-only enforcement
  - [ ] Sequence_number unique
  - [ ] SERIALIZABLE transactions
  - [ ] Snapshots working

- [ ] Sketcher 2D
  - [ ] Point, Line, Circle creation
  - [ ] Constraint types (distance, coincident, horizontal, vertical)
  - [ ] Cassowary integration
  - [ ] Solve validation

- [ ] CAO Operations
  - [ ] Pad operation
  - [ ] Pocket operation
  - [ ] Operation reordering
  - [ ] Geometry caching
  - [ ] BREP export

- [ ] Collaboration
  - [ ] Distributed locks
  - [ ] Lock heartbeat
  - [ ] WebSocket broadcast
  - [ ] User presence tracking

- [ ] Undo/Redo
  - [ ] Stack management
  - [ ] Event replay
  - [ ] Multi-user undo safety

### ⚠️ Risques mitigés

- [ ] Geometry computation timeout (30s max)
- [ ] Lock deadlock prevention (TTL + heartbeat)
- [ ] Event store corruption (transactional atomicity)
- [ ] WebSocket message loss (Redis ordering)
- [ ] Cassowary infeasibility (weak constraints)
- [ ] Database performance (indices + caching)
- [ ] Cache invalidation (event-driven)

### 📊 Métriques validées

- [ ] WebSocket latency < 200ms
- [ ] Geometry computation < 30s
- [ ] Event throughput >= 1000/sec
- [ ] Cache hit rate > 80%
- [ ] Load test 100+ concurrent users passed
- [ ] Data consistency verified (ACID)

---

## Prochaines Étapes

### Avant de commencer implémentation:

1. **Valider avec stakeholders**
   - [ ] Timeline (4 mois) acceptable?
   - [ ] Offline editing requirement?
   - [ ] Mobile support needed?
   - [ ] Budget/ressources confirmés?

2. **Setup infrastructure**
   - [ ] PostgreSQL 15 installed
   - [ ] Redis 7 installed
   - [ ] Development environment (Docker Compose)
   - [ ] CI/CD pipeline

3. **Prototype validation**
   - [ ] CadQuery + OCP working locally
   - [ ] Cassowary constraint solving proof-of-concept
   - [ ] WebSocket latency test
   - [ ] Event Store append performance test

4. **Documentation projet**
   - [ ] API specifications (OpenAPI/Swagger)
   - [ ] Database schema diagram (committed)
   - [ ] Component interaction diagrams
   - [ ] Testing strategy document

5. **Équipe formation**
   - [ ] Event Sourcing patterns (1 jour)
   - [ ] CadQuery tutorial (1 jour)
   - [ ] Cassowary solver concepts (0.5 jour)
   - [ ] Django Channels WebSocket (1 jour)

---

**Document de synthèse généré: 2026-03-03**

**Pour démarrer:** Contactez l'équipe architecture pour kick-off meeting
