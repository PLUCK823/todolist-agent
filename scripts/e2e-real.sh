#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export AUTH_JWT_SECRET=${AUTH_JWT_SECRET:-e2e-only-auth-secret-32-characters-minimum}

compose() {
  docker compose \
    -f "$ROOT_DIR/docker-compose.yml" \
    -f "$ROOT_DIR/docker-compose.e2e.yml" \
    "$@"
}

cleanup() {
  compose down -v --remove-orphans
}

on_exit() {
  status=$?
  if [ "$status" -ne 0 ]; then
    compose ps || true
    compose logs --no-color --tail=120 postgres redis backend agent frontend || true
  fi
  cleanup
  exit "$status"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cleanup
compose up -d --build --wait
(
  cd "$ROOT_DIR/frontend"
  E2E_BASE_URL=${E2E_BASE_URL:-http://127.0.0.1:3000} pnpm e2e:real
)
