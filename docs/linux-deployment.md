# Linux Deployment

This repository now deploys as two apps:

- `apps/web`: Next.js frontend
- `apps/api`: Go backend

## Key Files

- [docker-compose.yml](../infra/docker/docker-compose.yml)
- [Dockerfile.api](../infra/docker/Dockerfile.api)
- [.env.production.example](../infra/docker/.env.production.example)
- [Caddyfile](../infra/docker/Caddyfile)
- [update-duckdns.sh](../infra/scripts/update-duckdns.sh)

The current checked-in `docker-compose.yml` starts only `web` and `api`.
`Caddyfile` and `update-duckdns.sh` are kept as optional infrastructure assets if you want to add a reverse proxy or DuckDNS on top of the basic stack.

## Before You Start

1. Install Docker and Docker Compose on the Linux host.
2. Copy the repo to the server.
3. Create `infra/docker/.env.production` from `infra/docker/.env.production.example`.

## Run The Stack

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml up -d --build
```

This starts:

- `web` on port `3000`
- `api` on port `4000`

## Update The Stack

```bash
cd ~/flowiq
git pull
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## Logs

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml logs -f api
docker compose -f infra/docker/docker-compose.yml logs -f web
```

API runtime files are stored under `apps/api/storage/`.
