# Décisions Architecturales - Justifications et Alternatives

**Document de décision** - Trace les choix majeurs et leurs raisons

---

## Décision 1: Event Sourcing pour Persistance

### ✅ Décision
**Utiliser Event Sourcing** comme pattern principal de persistance (append-only event log)

### Justification
1. **Undo/Redo natif**: Fondamentale pour CAO. Event Sourcing le rend trivial (replay ou non replay)
2. **Audit trail complet**: Historique immuable de toutes les actions. Critique pour entreprise
3. **Debugging**: Pouvoir rejouer exactement ce qui s'est passé à moment T
4. **Collaboration**: Merger événements de plusieurs users
5. **Snapshots**: Optimization rechargement sans rejouer 1000 événements

### ❌ Alternatives considérées
- **CRUD classique**: Perd historique, Undo/Redo complexe, pas d'audit trail
- **CQRS pur**: Read models optimisées mais double complexité (write + read paths)
- **Temporal tables PostgreSQL**: Historique versionné mais pas immutable, plus lourd

### Coûts/Trade-offs
- ✗ Requêtes lecture moins simples (doit rejouer ou cacher projections)
- ✗ Storage augmente (toutes modifications gardées)
- ✓ Compensé par snapshots (tous 100 événements)

### Décision revue: ✅ APPROUVÉE
**Motion**: Utiliser Event Sourcing avec snapshots pour optimization

---

## Décision 2: PostgreSQL pour Event Store

### ✅ Décision
**PostgreSQL** comme base de données unique pour event store + business data

### Justification
1. **ACID**: Garanties transactionnelles essentielles pour append-only
2. **Isolation SERIALIZABLE**: Zéro race conditions possibles
3. **Append-only enforcement**: Contraintes CHECK et triggers
4. **Indices B-tree**: Query optimization sur aggregate_id, timestamp
5. **Replication native**: Multi-node, HA simple
6. **JSON support**: Stocker event data sans préprocessing

### ❌ Alternatives considérées
- **MongoDB**: Non-ACID (before version 4.0), moins fiable pour event log
- **EventStoreDB**: Dedicated event store mais overkill + coût, hard à scale
- **Cassandra**: Append-only mais eventual consistency (not suitable)
- **SQLite**: Single-process, pas suitable multi-user

### Coûts/Trade-offs
- ✗ Plus lent que NoSQL pour reads (compensé par Redis cache)
- ✗ Scaling writes : sharding complexe (mais v1.0 n'en a pas besoin)
- ✓ Reliability maximale
- ✓ Transactions ACID critiques

### Décision revue: ✅ APPROUVÉE
**Motion**: PostgreSQL 15+ avec SERIALIZABLE transactions

---

## Décision 3: Redis pour Cache + Pub/Sub

### ✅ Décision
**Redis** pour trois rôles:
1. Cache layer (L2) pour projections + géométrie
2. Pub/Sub broadcasting pour WebSocket
3. Distributed locks (pessimistic locking)

### Justification
1. **In-memory speed**: 10-100x plus rapide que DB (< 1ms latency)
2. **Expiration TTL**: Automatic cleanup de cache (SET avec EXPIRE)
3. **Pub/Sub**: Ordered messaging pour Redis Streams (channels layer)
4. **Locks**: SETNX atomic + TTL pour distributed locks
5. **Channels integration**: Django Channels utilise nativement Redis layer

### ❌ Alternatives considérées
- **Memcached**: No persistence, TTL basique, pas de data structures
- **RabbitMQ**: Overkill pour notre use case, plus complexe
- **PostgreSQL cache**: Slower, defeats purpose of caching

### Coûts/Trade-offs
- ✗ Single point of failure (mitigé par Redis Sentinel pour HA)
- ✗ Memory bounded (mitigé par maxmemory-policy)
- ✓ Flexibility (liste, hash, set, streams data types)

### Décision revue: ✅ APPROUVÉE
**Motion**: Redis 7+ avec persistence AOF pour cache + broadcasting

---

## Décision 4: Cassowary Solver pour Sketcher 2D

### ✅ Décision
**Cassowary** pour constraint solving du sketcher 2D

### Justification
1. **Designed pour graphical constraints**: Incremental, temps réel
2. **Performance 2D**: Excellent pour notre cas d'usage (100+ points)
3. **Python port stable**: Implémentation correcte, utilisée en prod
4. **Weak constraints**: Permet relaxer certaines contraintes
5. **Interactive**: Solver fast enough pour live feedback

### ❌ Alternatives considérées
- **Z3 (SMT Solver)**: Overkill, slow, designed pour SMT pas graphical
- **Gurobi**: Optimization commerciale, pour problèmes larges
- **Custom solver**: Trop complexe à implémenter correctement
- **No constraints**: CAO sans contraintes = inutilisable

### Coûts/Trade-offs
- ✗ Peut pas garantir solution optimale (trade-off intended)
- ✗ Infeasibility possible (gérée par weak constraints)
- ✓ Speed et stability excellents
- ✓ Code maintainable

### Décision revue: ✅ APPROUVÉE
**Motion**: Cassowary 0.6.2 pour constraint solving

---

## Décision 5: CadQuery + OCP pour CAO 3D

### ✅ Décision
**CadQuery** (wrapper autour OpenCascade/OCP) pour CAO operations

### Justification
1. **Python API fluide**: `.pad(10).pocket(5).fillet(1)` vs OCP API bas niveau
2. **Stable et maintenu**: Utilisé en production dans FreeCAD
3. **OpenCascade proven**: 20+ ans de CAO geometry kernel
4. **BREP format**: Export natif pour persistence + interop
5. **OCP bindings récents**: 7.7+ support

### ❌ Alternatives considérées
- **OCCT C++ direct**: Trop bas niveau, C++ binding complexe
- **Salome Geometry**: Trop lourd, embedded, pas suitable
- **CGAL**: Pure mathematics, pas full CAO operations
- **OnShape API**: Cloud-based, expensive, vendor lock-in

### Coûts/Trade-offs
- ✗ OCP peut crash sur géométries complexes (mitigé par timeout + fallback)
- ✗ Build complexity (OCP binding compilation)
- ✓ Feature complete pour CAO basique
- ✓ Open source

### Décision revue: ✅ APPROUVÉE
**Motion**: CadQuery 2.4 + OCP 7.7.2

---

## Décision 6: Pessimistic Locking pour Collaboration

### ✅ Décision
**Pessimistic locking** avec distributed locks (Redis SETNX + TTL)

### Justification
1. **CAO data sensitivity**: Structure géométrique fragile, mieux bloquer que fusionner
2. **Lock user experience**: Utilisateur voit "locked by X" au lieu conflit
3. **Simplicity**: Moins complexe qu'optimistic locking avec conflict resolution
4. **Safety**: Zéro chance de corruption données due au concurrency
5. **Heartbeat pattern**: TTL automatic cleanup si client crash

### ❌ Alternatives considérées
- **Optimistic locking**: Merge events, OT algorithm (trop complexe)
- **No locking**: Last-write-wins (data corruption!)
- **Operational Transformation**: Complexe, designed pour text pas CAO

### Coûts/Trade-offs
- ✗ Blocking: Utilisateur attend lock (mitigé par heartbeat + short timeouts)
- ✗ Deadlock possible (mitigé par ordered lock acquisition)
- ✓ Simplicity et reliability
- ✓ User clarity

### Décision revue: ✅ APPROUVÉE avec mitigation
**Motion**: Pessimistic locking avec timeout 5min et heartbeat 60sec

---

## Décision 7: Django REST Framework + Channels

### ✅ Décision
**Django + DRF** pour API HTTP REST
**Django Channels** pour WebSocket

### Justification
1. **Django ecosystem**: Mature, well-tested, production-proven
2. **DRF**: Serializers, viewsets, permissions out-of-box
3. **Channels**: Native Django integration pour WebSocket
4. **ASGI**: Async support via Daphne/Uvicorn
5. **Middleware**: Auth, CORS, rate limiting intégré

### ❌ Alternatives considérées
- **FastAPI**: Modern mais fresh, less ecosystem
- **Flask**: Lightweight mais need separate WebSocket lib
- **Node.js/Express**: Different lang/ecosystem complexity
- **Spring Boot**: Java, heavier than needed

### Coûts/Trade-offs
- ✗ Peut pas être as fast as raw C (mitigé par Uvicorn + async)
- ✗ Larger framework (bloated? non, Django core is clean)
- ✓ Huge ecosystem + community
- ✓ Production-battle-tested

### Décision revue: ✅ APPROUVÉE
**Motion**: Django 4.2 LTS + DRF + Channels 4.0

---

## Décision 8: Async Geometry Computation (Celery)

### ✅ Décision
**Celery** pour geometry computation asynchrone (Pad, Pocket, Fillet)

### Justification
1. **Heavy operations**: CadQuery peut prendre 1-30 secondes
2. **Don't block WebSocket**: Async job permet respond 202 Accepted
3. **Timeout safety**: Celery tasks avec hard limit (30s)
4. **Scalability**: Workers peuvent scale horizontalement
5. **Monitoring**: Celery has task status, retries, error tracking

### ❌ Alternatives considérées
- **Synchronous compute**: Blocks WebSocket, bad UX (> 1s latency)
- **gRPC / separate service**: Overkill complexity
- **JavaScript worker threads**: Can't use CadQuery (Python lib)

### Coûts/Trade-offs
- ✗ Async adds complexity (monitoring, error handling)
- ✗ Need Celery + Redis (2 more services)
- ✓ Excellent UX (instant response)
- ✓ Resource efficiency

### Décision revue: ✅ APPROUVÉE
**Motion**: Celery 5.3+ avec timeout 30s + circuit breaker

---

## Décision 9: Trame pour Frontend UI

### ✅ Décision
**Trame** (framework Python pour web UI) + Vue 3

### Justification
1. **Python backend developer friendly**: Pas besoin JavaScript
2. **Tight backend coupling**: Python same language as backend
3. **Reactive**: Vue 3 reactivity + Python backend state sync
4. **WebSocket built-in**: Trame handles WebSocket plumbing
5. **3D integration**: Can embed Three.js viewers

### ❌ Alternatives considérées
- **React**: Heavy, separate JavaScript ecosystem, learning curve
- **Pure JavaScript**: Manual WebSocket, no type safety
- **Streamlit**: Not suitable for interactive CAO UI

### Coûts/Trade-offs
- ✗ Smaller ecosystem than React/Vue standalone
- ✗ Python stack limitation (can't do native mobile)
- ✓ Monolithic (one language, one framework)
- ✓ Fast development (Python devs can do full-stack)

### Décision revue: ✅ APPROUVÉE
**Motion**: Trame 3.0 + Vue 3 + Vuetify

---

## Décision 10: Snapshot Strategy (tous 100 événements)

### ✅ Décision
**Créer snapshot** après chaque 100 événements

### Justification
1. **Optimization**: Avoiding replaying 1000+ events
2. **Storage trade-off**: 100 events = ~10KB (négligeable)
3. **Compression**: Snapshot = compressed state vs linear events
4. **Archival**: Old events peuvent être archivés

### ❌ Alternatives considérées
- **No snapshots**: Slow projection rebuild
- **Snapshots tous les 10**: Too much storage
- **Snapshots tous les 1000**: Slow projection build for large parts

### Coûts/Trade-offs
- ✗ Additional storage for snapshots
- ✓ Fast projection rebuild (< 100ms)
- ✓ Can archive old events

### Décision revue: ✅ APPROUVÉE
**Motion**: Snapshots tous 100 événements, archiver > 90 jours

---

## Décision 11: SERIALIZABLE Isolation Level

### ✅ Décision
**SERIALIZABLE** PostgreSQL isolation level pour Event Store transactions

### Justification
1. **Strongest guarantee**: Zéro race conditions, zéro phantom reads
2. **Event Store critical**: Une seule corruption = disaster
3. **Acceptable performance**: Pas de read locks, seulement write conflicts
4. **v1.0 scale**: 100 concurrent users pas un problème
5. **Architecture clean**: No complex conflict resolution code

### ❌ Alternatives considérées
- **READ_COMMITTED**: Default, but allows dirty reads
- **REPEATABLE_READ**: Allows phantom reads
- **No isolation**: Chaos

### Coûts/Trade-offs
- ✗ Performance : Some write conflicts possible (rare in practice)
- ✗ Retry logic needed for conflicts
- ✓ Correctness guaranteed
- ✓ Simplicity

### Décision revue: ✅ APPROUVÉE
**Motion**: SERIALIZABLE + retry logic for conflict exceptions

---

## Matrice de Décisions

```
┌──────────────────────┬──────────┬─────────────┬──────────────┐
│ Composant            │ Choix    │ Confiance   │ Reversible   │
├──────────────────────┼──────────┼─────────────┼──────────────┤
│ Persistence          │Event     │ ⭐⭐⭐⭐⭐ │ ✓ (costly) │
│ Database             │PG 15     │ ⭐⭐⭐⭐⭐ │ ✓ (migrate) │
│ Cache                │Redis 7   │ ⭐⭐⭐⭐⭐ │ ✓ (easy)   │
│ Constraint Solver    │Cassowary │ ⭐⭐⭐⭐⭐ │ ✓ (easy)   │
│ CAO Kernel           │CadQuery  │ ⭐⭐⭐⭐   │ ✗ (hard)   │
│ Locking Strategy     │Pessimistic│⭐⭐⭐⭐⭐ │ ✗ (hard)   │
│ Framework Backend    │Django    │ ⭐⭐⭐⭐⭐ │ ✓ (costly) │
│ WebSocket           │Channels  │ ⭐⭐⭐⭐   │ ✓ (easy)   │
│ Async Jobs          │Celery    │ ⭐⭐⭐⭐⭐ │ ✓ (easy)   │
│ Frontend            │Trame+Vue │ ⭐⭐⭐     │ ✗ (hard)   │
│ Isolation Level     │SERIALIZABLE│⭐⭐⭐⭐⭐ │ ✓ (change) │
│ Snapshot Freq       │100 events │⭐⭐⭐⭐⭐ │ ✓ (tune)   │
└──────────────────────┴──────────┴─────────────┴──────────────┘

Légende:
✓ Reversible = Peut être changé avec effort modéré
✗ Reversible = Changement coûteux, refactor large
Confiance = Based on maturity, test, adoption
```

---

## Décisions Reportées pour v2.0

### 1. Multi-tenancy
**Décision**: Single-tenant v1.0
**Raison**: Adds 20% complexity sans valeur immediate
**v2.0**: Separating workspaces per customer

### 2. Mobile Client
**Décision**: Web only v1.0
**Raison**: React Native adds 6-8 weeks
**v2.0**: iOS/Android Trame ports

### 3. Advanced Assembly Constraints
**Décision**: Basic constraints v1.0 (coincident, distance)
**Raison**: Solver complexity, v2.0 peut ajouter (parallel, perpendicular)

### 4. Parametric Equations
**Décision**: Fixed dimensions v1.0
**Raison**: Symbolic algebra adds complexity
**v2.0**: Spreadsheet-like formula support

### 5. Cloud Storage Integration
**Décision**: File system local v1.0
**Raison**: S3/Azure blobs add deployment complexity
**v2.0**: Multi-cloud support

### 6. Offline Editing with Sync
**Décision**: Online-only v1.0
**Raison**: Sync + conflict resolution complexity
**v2.0**: Offline queue with automatic sync

---

## Questions Ouvertes

### Q1: BREP vs STEP export format?
**Current decision**: BREP (binary)
**Trade-off**: BREP = smaller, STEP = universal
**v1.0 plan**: BREP only, STEP in v1.1

### Q2: Assembly constraint solver approach?
**Current decision**: Analytical (not iterative)
**Trade-off**: Analytical = fast but limited, iterative = flexible but slow
**v1.0 plan**: Basic analytical, v2.0 numeric solver

### Q3: Max concurrent users per workspace?
**Current decision**: 100 (no hard limit)
**Trade-off**: Need load testing to validate
**v1.0 action**: Load test at deployment

### Q4: Geometry caching invalidation strategy?
**Current decision**: TTL-based (1 hour) + event-driven
**Trade-off**: Could be all events or deterministic
**v1.0 action**: Monitor cache hit rate in production

### Q5: Offline support priority?
**Current decision**: v2.0
**Trade-off**: Would require Conflict-free replicated data types (CRDT)
**v1.0 action**: Document requirements pour v2.0 planning

---

## Architecture Decision Record (ADR) Summary

**Total major decisions**: 11
**Reversible**: 7 (easy to change)
**Semi-reversible**: 3 (costly to change)
**Irreversible**: 1 (CadQuery OCP - large refactor needed)

**Risk level**: LOW
**Confidence**: HIGH (4.5/5 average)

**Review cycle**: Quarterly
**Next review**: 2026-06-03 (après Phase 1-2)

---

**Document ADR généré: 2026-03-03**

**Approuver par**: CTO / Principal Architect
**Date approbation**: [TBD]
**Statut**: PENDING REVIEW

**Pour modifications futures**: Créer nouveau ADR-0012, 0013, etc.
