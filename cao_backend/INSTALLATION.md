# Phase 1 - Installation et Démarrage

## 📋 Pré-requis

1. **Python 3.13+**
   ```bash
   python --version  # Should be 3.13+
   ```

2. **PostgreSQL 15+** (optionnel pour les tests de base)
   ```bash
   # Mac
   brew install postgresql@15
   brew services start postgresql@15
   
   # Linux
   sudo apt-get install postgresql postgresql-contrib
   ```

3. **Redis** (pour Celery + Channels)
   ```bash
   # Mac
   brew install redis
   brew services start redis
   
   # Linux
   sudo apt-get install redis-server
   ```

## 🚀 Installation

### 1. Créer la base de données PostgreSQL

```bash
# Accéder à PostgreSQL
psql -U postgres

# Dans le prompt PostgreSQL:
CREATE DATABASE cao_db;
CREATE USER cao_user WITH PASSWORD 'cao_password';
ALTER ROLE cao_user SET client_encoding TO 'utf8';
ALTER ROLE cao_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE cao_user SET default_transaction_deferrable TO on;
ALTER ROLE cao_user SET default_transaction_read_committed TO on;
ALTER USER cao_user CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE cao_db TO cao_user;
\connect cao_db
CREATE EXTENSION IF NOT EXISTS uuid-ossp;
\q
```

### 2. Activer l'environnement virtuel

```bash
cd cao_backend
source venv/bin/activate  # Mac/Linux
# ou
venv\Scripts\activate  # Windows
```

### 3. Appliquer les migrations

```bash
python manage.py migrate
```

### 4. Créer un utilisateur superadmin (optionnel)

```bash
python manage.py createsuperuser
# Prompts:
# Username: admin
# Email: admin@example.com
# Password: ****
```

### 5. Démarrer le serveur de développement

```bash
# Mode HTTP (test rapide)
python manage.py runserver

# Mode ASGI (avec WebSocket support)
daphne -b 0.0.0.0 -p 8000 cao_config.asgi:application
```

Le serveur est disponible sur: http://localhost:8000

## 🧪 Tester l'API

### Obtenir un token JWT

```bash
curl -X POST http://localhost:8000/api/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_password"
  }'

# Réponse:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### Créer un projet

```bash
curl -X POST http://localhost:8000/api/projects/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mon Premier Projet CAO",
    "description": "Un projet de test"
  }'
```

### Lister les projets

```bash
curl -X GET http://localhost:8000/api/projects/ \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📊 Documentation API

L'API complète est documentée sur:

- **Swagger UI**: http://localhost:8000/api/docs/
- **Schema OpenAPI**: http://localhost:8000/api/schema/

## 🔍 Vérifier les migrations

```bash
# Voir les migrations appliquées
python manage.py showmigrations

# Voir le SQL d'une migration
python manage.py sqlmigrate cao_core 0001

# Reset la BD complète (WARNING: Perte de données!)
python manage.py migrate zero
```

## 🛠️ Commandes utiles

```bash
# Créer des migrations après modèle change
python manage.py makemigrations

# Shell Django interactif
python manage.py shell

# Exemple d'usage du shell:
from cao_core.models import Project
from django.contrib.auth.models import User
user = User.objects.first()
Project.objects.create(owner=user, name="Test")

# Lancer les tests
python manage.py test

# Accéder à l'admin Django
# http://localhost:8000/admin/
```

## 🐛 Troubleshooting

### "can't connect to PostgreSQL"
```bash
# Vérifier que PostgreSQL est actif
brew services list

# Redémarrer PostgreSQL
brew services restart postgresql@15

# Vérifier la connexion
psql -h localhost -U cao_user -d cao_db
```

### "redis connection refused"
```bash
# Vérifier Redis
brew services list

# Redémarrer Redis
brew services restart redis

# Ou démarrer manuellement
redis-server
```

### "ModuleNotFoundError"
```bash
# Réinstaller les dépendances
source venv/bin/activate
pip install -r requirements.txt
```

### "Port 8000 already in use"
```bash
# Utiliser un port différent
python manage.py runserver 8001

# Ou tuer le processus
lsof -i :8000
kill -9 <PID>
```

## 📝 Notes

1. **Environment variables**: Certifier que le `.env` a la bonne config:
   ```
   DB_NAME=cao_db
   DB_USER=cao_user
   DB_PASSWORD=cao_password
   DB_HOST=localhost
   ```

2. **Logs**: Vérifier les logs de debug:
   ```bash
   tail -f logs/cao.log
   ```

3. **Admin Django**: Pour gérer les projets/utilisateurs via l'UI:
   ```
   http://localhost:8000/admin/
   ```

## ✅ Test complet (Phase 1)

```bash
#!/bin/bash
set -e

cd cao_backend
source venv/bin/activate

echo "✓ Running migrations..."
python manage.py migrate

echo "✓ Running tests..."
python manage.py test

echo "✓ Starting server..."
python manage.py runserver

echo "✓ Server running at http://localhost:8000"
echo "✓ API Docs at http://localhost:8000/api/docs/"
```

## 🎯 Phase 2 - Prochaines étapes

Une fois Phase 1 confirmée fonctionnelle:

1. Implémenter CadQuery integration
2. Créer le sketcher 2D avec Cassowary solver
3. Ajouter les views Trame
4. Tests E2E complètement

---

**Phase 1 Status**: ✅ COMPLÉTÉE
**Total code**: ~2,500 lignes
**Fichiers créés**: 20+
