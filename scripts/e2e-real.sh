#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

compose() {
  docker compose \
    -f "$ROOT_DIR/docker-compose.yml" \
    -f "$ROOT_DIR/docker-compose.e2e.yml" \
    "$@"
}

cleanup() {
  compose down -v --remove-orphans
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cleanup
compose up -d --build --wait
(
  cd "$ROOT_DIR/frontend"
  E2E_BASE_URL=${E2E_BASE_URL:-http://127.0.0.1:3000} pnpm e2e:real
)
