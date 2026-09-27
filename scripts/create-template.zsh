#!/usr/bin/env zsh
# Creates the newsletter template in Google Drive using gws:
#   folder -> seeded template Doc -> placeholder attachment -> bound Apps Script.
# Re-running resumes: IDs are kept in .deploy.env and existing steps are skipped.
# Requires gws scopes: drive, documents, script.projects.
set -euo pipefail
cd "${0:A:h}/.."

ENV_FILE=.deploy.env
[[ -f $ENV_FILE ]] && source $ENV_FILE
: ${FOLDER_NAME:="Weekly Update Newsletter"}
: ${DOC_NAME:="Weekly Update - Week of 9/21"}

gj() { gws "$@" 2>/dev/null; }                     # gws prints keyring notices on stderr
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);if(o.error){console.error(o.error.message);process.exit(1)}console.log(o[process.argv[1]])})' "$1"; }
save() { print -r -- "$1=${(P)1}" >> $ENV_FILE; }

if [[ -z ${FOLDER_ID:-} ]]; then
  FOLDER_ID=$(gj drive files create --params '{"fields":"id"}' \
    --json "{\"name\":\"$FOLDER_NAME\",\"mimeType\":\"application/vnd.google-apps.folder\"}" | field id)
  save FOLDER_ID; print "Folder:     $FOLDER_ID"
fi

if [[ -z ${DOC_ID:-} ]]; then
  DOC_ID=$(gj drive files create --params '{"fields":"id"}' \
    --json "{\"name\":\"$DOC_NAME\",\"mimeType\":\"application/vnd.google-apps.document\",\"parents\":[\"$FOLDER_ID\"]}" \
    --upload template/weekly-update.html --upload-content-type text/html | field id)
  save DOC_ID; print "Doc:        $DOC_ID"
else
  # Make sure a pre-existing Doc lives in the folder.
  gj drive files update --params "{\"fileId\":\"$DOC_ID\",\"addParents\":\"$FOLDER_ID\",\"fields\":\"id\"}" --json '{}' >/dev/null
fi

if [[ -z ${ATTACHMENT_ID:-} ]]; then
  ATTACHMENT_ID=$(gj drive files create --params '{"fields":"id"}' \
    --json "{\"name\":\"Placeholder attachment.pdf\",\"parents\":[\"$FOLDER_ID\"]}" \
    --upload template/placeholder-attachment.pdf --upload-content-type application/pdf | field id)
  gj drive permissions create --params "{\"fileId\":\"$ATTACHMENT_ID\"}" --json '{"role":"reader","type":"anyone"}' >/dev/null
  save ATTACHMENT_ID; print "Attachment: $ATTACHMENT_ID"
fi

if [[ -z ${SEEDED:-} ]]; then
  node cli/newsletter.mjs seed --doc "$DOC_ID" --attachment-url "https://drive.google.com/file/d/$ATTACHMENT_ID/view"
  SEEDED=1; save SEEDED
fi

if [[ -z ${SCRIPT_ID:-} ]]; then
  SCRIPT_ID=$(gj script projects create --json "{\"title\":\"Weekly Update Newsletter\",\"parentId\":\"$DOC_ID\"}" | field scriptId) || {
    print -u2 "Could not create the Apps Script project. Enable the Apps Script API at"
    print -u2 "https://script.google.com/home/usersettings and make sure gws has the script.projects scope."
    exit 1
  }
  save SCRIPT_ID; print "Script:     $SCRIPT_ID"
fi

zsh scripts/deploy-script.zsh

print "\nTemplate ready: https://docs.google.com/document/d/$DOC_ID/edit"
print "Open it, reload once, then use the Newsletter menu (first use asks for authorization)."
