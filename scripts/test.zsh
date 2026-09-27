#!/usr/bin/env zsh
# Runs the test suite in Docker (falls back to docker-compose, then local Node via mise).
set -euo pipefail
cd "${0:A:h}/.."
if docker compose version >/dev/null 2>&1; then
  docker compose run --rm --build test
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose run --rm --build test
else
  mise exec -- npm test
fi
