# Deployment Update Checklist

Use this when a new FlowIQ version is pushed and you need to refresh the Linux deployment.

This checklist assumes you are using the current checked-in Docker setup in `infra/docker/docker-compose.yml`, which runs the `postgres`, `api`, and `web` services.

## Standard Update

```bash
ssh balaji@your-server-ip
cd ~/flowiq
git pull
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## Verification

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 postgres
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml logs --tail=100 web
curl http://localhost:4000/api/health
```

## If Frontend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml up -d --build web
```

## If Backend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml up -d --build api
```
