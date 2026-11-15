#!/usr/bin/env bash
# Create a platform admin (asks for the password; it is never put on the command line).
#   sudo /opt/itopmed/bin/itopmed-admin you@example.uz "Full Name" [SUPER_ADMIN]
set -euo pipefail
EMAIL="${1:?email}"; NAME="${2:?full name}"; ROLE="${3:-SUPER_ADMIN}"
set -a; . /etc/itopmed/itopmed.env; set +a
cd /opt/itopmed/current/app
exec runuser -p -u itopmed -- /opt/itopmed/node/bin/node admin.mjs --email "$EMAIL" --name "$NAME" --role "$ROLE"
