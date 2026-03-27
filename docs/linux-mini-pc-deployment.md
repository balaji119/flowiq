# Linux Mini PC Deployment

This repository now deploys as two apps:

- `apps/web`: Next.js frontend
- `apps/api`: Go backend

## Key Files

- [docker-compose.yml](/C:/Users/BKanagaraju/.codex/worktrees/1cf3/FlowIQ/infra/docker/docker-compose.yml)
- [Dockerfile.api](/C:/Users/BKanagaraju/.codex/worktrees/1cf3/FlowIQ/infra/docker/Dockerfile.api)
- [.env.production.example](/C:/Users/BKanagaraju/.codex/worktrees/1cf3/FlowIQ/infra/docker/.env.production.example)
- [update-duckdns.sh](/C:/Users/BKanagaraju/.codex/worktrees/1cf3/FlowIQ/infra/scripts/update-duckdns.sh)

## Before You Start

1. Install Docker and Docker Compose on the mini PC.
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
