#!/usr/bin/env zsh
# Publishes docs/ to michaelbino.com/projects/weekly-update/
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
ROOT_DIR="${SCRIPT_DIR}/.."
DOCS_DIR="${ROOT_DIR}/docs"
TARGET_DIR="${1:-${ROOT_DIR}/../michaelbino.com/projects/weekly-update}"

echo "==> Publishing Weekly Update documentation to: ${TARGET_DIR}"

if [[ ! -d "${DOCS_DIR}" ]]; then
  echo "Error: Source docs directory '${DOCS_DIR}' not found." >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

# Rsync static website assets into destination
rsync -av --delete \
  --exclude '.nojekyll' \
  --exclude '.DS_Store' \
  "${DOCS_DIR}/" "${TARGET_DIR}/"

echo "==> Published successfully to ${TARGET_DIR}"
