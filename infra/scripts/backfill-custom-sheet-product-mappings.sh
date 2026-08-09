#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-infra/docker/docker-compose.yml}"

echo "Running DB migrations..."
docker compose -f "$COMPOSE_FILE" exec -T api ./flowiq-api migrate

echo "Backfilling custom sheet product mappings..."
docker compose -f "$COMPOSE_FILE" exec -T api ./flowiq-api backfill-custom-sheet-product-mappings

echo "Done."
