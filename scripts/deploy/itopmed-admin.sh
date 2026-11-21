#!/usr/bin/env bash
# Create a platform admin (asks for the password; it is never put on the command line).
#   sudo /opt/itopmed/bin/itopmed-admin admin.login "Full Name" [SUPER_ADMIN]
set -euo pipefail
LOGIN="${1:?login}"; NAME="${2:?full name}"; ROLE="${3:-SUPER_ADMIN}"
set -a; . /etc/itopmed/itopmed.env; set +a
cd /opt/itopmed/current/app
exec runuser -p -u itopmed -- /opt/itopmed/node/bin/node admin.mjs --login "$LOGIN" --name "$NAME" --role "$ROLE"
