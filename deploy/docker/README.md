# Docker Production Deployment

## Quick Start

```bash
# 1. Copy and edit config
cp config/local.docker.yaml config/local.yaml
# Edit config/local.yaml with your settings (DB, auth tokens, etc.)

# 2. Copy and edit environment
cp .env.example .env
# Edit .env (HOST_PORT, SERVICE_NAME, etc.)

# 3. Build and run
docker compose up -d --build
```

## Build Only

```bash
docker compose build
```

## Run Without Compose

```bash
docker build -t mcp-metro -f deploy/docker/Dockerfile .

docker run -d \
  --name mcp-metro \
  -p 9049:9049 \
  -e NODE_ENV=production \
  -e WS_PORT=9049 \
  -v $(pwd)/deploy/docker/config/local.yaml:/app/config/local.yaml:ro \
  mcp-metro
```

## Configuration

The container uses `node-config` (the `config` npm package). Config is resolved in this order:

1. `config/default.yaml` — baked into the image
2. `config/production.yaml` — environment-specific overrides
3. `config/local.yaml` — **mounted via Docker volume** (your custom settings)
4. Environment variables — mapped via `config/custom-environment-variables.yaml`

Key environment variables:

| Variable | Config key | Description |
|----------|-----------|-------------|
| `WS_PORT` | `webServer.port` | HTTP server port (default: 9049) |
| `WS_HOST` | `webServer.host` | Bind address (default: 0.0.0.0) |
| `NODE_ENV` | — | Node environment (production) |
| `DB_HOST` | `db.postgres.dbs.main.host` | PostgreSQL host |
| `DB_PORT` | `db.postgres.dbs.main.port` | PostgreSQL port |
| `DB_NAME` | `db.postgres.dbs.main.database` | Database name |
| `DB_USER` | `db.postgres.dbs.main.user` | Database user |
| `DB_PASSWORD` | `db.postgres.dbs.main.password` | Database password |

## Health Check

The container includes a built-in health check:

```
GET http://localhost:9049/health
```

Response:
```json
{
  "status": "healthy",
  "details": {
    "uptime": 123.456,
    "memoryUsage": { ... },
    "timestamp": "..."
  }
}
```

## Useful Commands

```bash
# View logs
docker compose logs -f app

# Restart
docker compose restart app

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build --force-recreate app
```
