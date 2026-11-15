#!/usr/bin/env bash
# Forced command of the GitHub Actions deploy key (see .github/workflows/deploy.yml).
# The key can do only this: receive a release and install it with the installer
# that ships inside that release. Input on stdin:
#   first line "<bytes> <sha256>", then exactly that many bytes of the tarball.
# A short, broken or altered upload is rejected before anything is installed.
# One deploy at a time; a stalled upload gives up after 15 minutes.
set -euo pipefail
exec 9>/var/lock/itopmed-deploy.lock
flock -w 600 9
umask 077
dir="$(mktemp -d /root/itopmed-deploy.XXXXXX)"
trap 'rm -rf "$dir"' EXIT
read -r size sum || { echo "No release header" >&2; exit 2; }
[[ "$size" =~ ^[0-9]+$ && "$size" -le 400000000 && "$sum" =~ ^[0-9a-f]{64}$ ]] || { echo "Bad release header" >&2; exit 2; }
timeout 900 head -c "$size" > "$dir/release.tar.gz" || true
got="$(stat -c %s "$dir/release.tar.gz")"
[ "$got" = "$size" ] || { echo "Upload incomplete ($got of $size bytes); nothing installed" >&2; exit 3; }
echo "$sum  $dir/release.tar.gz" | sha256sum -c --quiet - || { echo "Checksum mismatch; nothing installed" >&2; exit 3; }
tar -xzf "$dir/release.tar.gz" -C "$dir" ./server-install.sh ./itopmed-admin.sh
bash "$dir/server-install.sh" "$dir/release.tar.gz" itopmed.itoppos.uz
