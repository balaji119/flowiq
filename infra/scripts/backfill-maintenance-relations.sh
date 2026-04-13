#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-infra/docker/docker-compose.yml}"

echo "Running DB migrations..."
docker compose -f "$COMPOSE_FILE" exec -T api ./flowiq-api migrate

echo "Backfilling maintenance relations..."
docker compose -f "$COMPOSE_FILE" exec -T api ./flowiq-api backfill-maintenance-relations

echo "Done."
