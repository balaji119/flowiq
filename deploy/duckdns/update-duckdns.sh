#!/bin/sh
set -eu

if [ -z "${DUCKDNS_SUBDOMAIN:-}" ] || [ -z "${DUCKDNS_TOKEN:-}" ]; then
  echo "DUCKDNS_SUBDOMAIN and DUCKDNS_TOKEN are required"
  exit 1
fi

UPDATE_URL="https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip="

while true
do
  wget -qO- "${UPDATE_URL}" || true
  echo " duckdns update at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  sleep "${DUCKDNS_UPDATE_INTERVAL_SECONDS:-300}"
done
