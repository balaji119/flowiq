# Linux Deployment

This repository deploys as three services in the main app stack:

- `apps/web`: Next.js frontend
- `apps/api`: Go backend
- `postgres`: PostgreSQL database

## Key Files

- [docker-compose.yml](../infra/docker/docker-compose.yml)
- [Dockerfile.api](../infra/docker/Dockerfile.api)
- [.env.production.example](../infra/docker/.env.production.example)
- [Caddyfile](../infra/docker/Caddyfile)
- [update-duckdns.sh](../infra/scripts/update-duckdns.sh)

The checked-in `docker-compose.yml` starts `postgres`, `api`, and `web`.
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
6. If you are using Caddy, set `DOMAIN`.

## Run The Stack

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml up -d --build
```

This starts:

- `postgres` on the internal Docker network only
- `web` on port `3000`
- `api` on port `4000`

The PostgreSQL port is intentionally not published on the host. The `api` container connects to it internally using `DATABASE_URL=postgres://...@postgres:5432/...`.

## Reverse Proxy

If you want to serve the app on a domain instead of hitting `:3000` and `:4000` directly, run a reverse proxy with the checked-in [Caddyfile](../infra/docker/Caddyfile).

That Caddy config expects:

- the frontend container to be reachable as `web:3000`
- the backend container to be reachable as `api:4000`
- browser requests to call `/api/*` on the same origin

If you are using a legacy or separate proxy stack, make sure that stack proxies to the current frontend and backend containers. Do not keep serving static files from an old `dist-web` folder, or you will keep seeing stale UI changes after deploys.

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
```

API runtime files are stored under `apps/api/storage/`.
PostgreSQL data is stored in the named Docker volume `postgres-data`.

## Common Production Checks

After a deploy, verify:

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml logs --tail=100 web
curl http://localhost:4000/api/health
curl -I http://localhost:3000
```

If you are using a separate Caddy container or service, also verify that it is proxying to the live app stack and not to an old static site.
