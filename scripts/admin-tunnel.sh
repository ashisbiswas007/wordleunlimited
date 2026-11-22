#!/bin/sh
# Opens the admin panel to this machine only, through SSH.
#
#   ./scripts/admin-tunnel.sh          then open http://localhost:3901/admin
#
# The panel listens on port 3901 inside the app container and is published
# nowhere, so the public internet cannot reach it. This asks the server for the
# container's current address (it changes on every deploy) and forwards a
# local port to it. Ctrl-C closes it.
#
#   HOST       SSH alias of the server            (default: control)
#   APP        Coolify resource id of the app     (default: the live one)
#   LOCAL_PORT port on this machine               (default: 3901)
set -eu
HOST="${HOST:-control}"
APP="${APP:-r9x11adoljvei39v5mbq7iwa}"
LOCAL_PORT="${LOCAL_PORT:-3901}"

IP=$(ssh "$HOST" "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \$(docker ps -qf name=app-$APP) | awk '{print \$1}'")
if [ -z "$IP" ]; then
  echo "Could not find the app container (app-$APP) on $HOST." >&2
  exit 1
fi

echo "Admin panel: http://localhost:$LOCAL_PORT/admin   (Ctrl-C to close)"
exec ssh -N -L "$LOCAL_PORT:$IP:3901" "$HOST"
