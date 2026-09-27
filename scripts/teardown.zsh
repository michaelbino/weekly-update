#!/usr/bin/env zsh
# Moves the template folder (Doc, bound script, attachment, settings) to Drive trash.
# Issues created elsewhere and the "Newsletter images" folder are left alone.
set -euo pipefail
cd "${0:A:h}/.."
source .deploy.env
: ${FOLDER_ID:?FOLDER_ID missing from .deploy.env}

read -q "REPLY?Move folder $FOLDER_ID and everything in it to the Drive trash? [y/N] " || { print; exit 1; }
print
gws drive files update --params "{\"fileId\":\"$FOLDER_ID\",\"fields\":\"id,trashed\"}" --json '{"trashed":true}' 2>/dev/null
# Bound scripts live in their Doc, so trashing the folder also trashes the script.
rm -f .deploy.env
print "Trashed. Restore from Drive trash within 30 days if needed."
