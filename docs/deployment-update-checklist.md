# Deployment Update Checklist

Use this when a new FlowIQ version is pushed and you need to refresh the Linux deployment.

This checklist assumes you are using the current checked-in Docker setup in `infra/docker/docker-compose.yml`, which runs `caddy`, `postgres`, `api`, and `web` together.

## Standard Update

```bash
ssh balaji@your-server-ip
cd ~/flowiq
git pull
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## Verification

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml logs --tail=100 web
docker compose -f infra/docker/docker-compose.yml logs --tail=100 caddy
curl http://localhost:4000/api/health
curl -I http://localhost:3000
```

Also verify that:

- `/` proxies to `web:3000`
- `/api/*` proxies to `api:4000`
- the checked-in Caddy service owns ports `80` and `443`

## If Frontend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build web
```

Then confirm the browser is calling same-origin `/api/...` routes and not `http://api:4000/...`.

## If Backend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build api
```

## One-Time Migration From An Older Separate Caddy Stack

If your server still has an older standalone Caddy container such as `deploy-caddy-1`, remove it before using the checked-in stack Caddy service:

```bash
docker stop deploy-caddy-1
docker rm deploy-caddy-1
```

After the new stack is healthy, remove the old API container too if it still exists:

```bash
docker stop deploy-api-1
docker rm deploy-api-1
```

## If The API Container Restarts In A Loop

```bash
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
```

The API image must contain `apps/api/db/migrations`. If you see `open db/migrations: no such file or directory`, rebuild with the latest checked-in [Dockerfile.api](../infra/docker/Dockerfile.api).
