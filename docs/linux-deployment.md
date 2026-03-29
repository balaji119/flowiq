# Linux Deployment

This repository deploys as four services in the main app stack:

- `caddy`: reverse proxy
- `apps/web`: Next.js frontend
- `apps/api`: Go backend
- `postgres`: PostgreSQL database

## Key Files

- [docker-compose.yml](../infra/docker/docker-compose.yml)
- [Dockerfile.api](../infra/docker/Dockerfile.api)
- [.env.production.example](../infra/docker/.env.production.example)
- [Caddyfile](../infra/docker/Caddyfile)
- [update-duckdns.sh](../infra/scripts/update-duckdns.sh)

The checked-in `docker-compose.yml` starts `caddy`, `postgres`, `api`, and `web`.
The checked-in `Caddyfile` is for a reverse proxy that fronts those services and routes:

- `/` to `web:3000`
- `/api/*` to `api:4000`

The frontend is built inside the `web` container before `next start`, and production browser requests should use same-origin `/api/*` through the reverse proxy.

## Before You Start

1. Install Docker and Docker Compose on the Linux host.
2. Copy the repo to the server.
3. Create `infra/docker/.env.production` from `infra/docker/.env.production.example`.
4. Set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `DATABASE_URL` in that file.
5. Set a real `JWT_SECRET`.
6. Set `DOMAIN` for Caddy.

## Run The Stack

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml up -d --build
```

This starts:

- `caddy` on ports `80` and `443`
- `postgres` on the internal Docker network only
- `web` on port `3000`
- `api` on port `4000`

The PostgreSQL port is intentionally not published on the host. The `api` container connects to it internally using `DATABASE_URL=postgres://...@postgres:5432/...`.

## Required DB Bootstrap (Highlight)

After first deploy (or after clearing DB), run migration and seed from inside the `api` container.
Do not run `go run` inside the container because Go toolchain is not installed in the runtime image.

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml exec -T api ./flowiq-api migrate
docker compose -f infra/docker/docker-compose.yml exec -T api ./flowiq-api seed
```

Verify seeded users exist:

```bash
docker compose -f infra/docker/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select email, role, active from users order by role, email;"
```

If this query returns `(0 rows)`, you likely seeded a different database/stack.

## Reverse Proxy

The main stack now includes Caddy directly. The checked-in [Caddyfile](../infra/docker/Caddyfile) proxies:

- `/` to `web:3000`
- `/api/*` to `api:4000`

Production browser requests should call same-origin `/api/*`.

## One-Time Migration From An Older Separate Caddy Stack

If your server still has an older standalone Caddy container such as `deploy-caddy-1`, stop and remove it before starting the checked-in stack with Caddy enabled. Otherwise ports `80` and `443` will already be in use.

```bash
docker stop deploy-caddy-1
docker rm deploy-caddy-1
```

If that older stack also has a legacy API container, remove that too after confirming the new `infra/docker` stack is healthy:

```bash
docker stop deploy-api-1
docker rm deploy-api-1
```

## Update The Stack

```bash
cd ~/flowiq
git pull
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Using `down` followed by `up -d --build` is the safest refresh path for production because it rebuilds the current app images and restarts the running services cleanly.

## Logs

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml logs -f api
docker compose -f infra/docker/docker-compose.yml logs -f web
docker compose -f infra/docker/docker-compose.yml logs -f postgres
docker compose -f infra/docker/docker-compose.yml logs -f caddy
```

API runtime files are stored under `apps/api/storage/`.
PostgreSQL data is stored in the named Docker volume `postgres-data`.

## Common Production Checks

After a deploy, verify:

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml logs --tail=100 web
docker compose -f infra/docker/docker-compose.yml logs --tail=100 caddy
curl http://localhost:4000/api/health
curl -I http://localhost:3000
```

Also verify that the public domain now resolves through the checked-in Caddy service, not through an older standalone proxy container.
