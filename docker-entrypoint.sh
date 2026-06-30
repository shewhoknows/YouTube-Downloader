#!/bin/sh
# Launch the PO-token provider (if present) in the background, then the web app.
# The provider lets yt-dlp pass YouTube's bot check from a datacenter IP without
# any login. If it fails to start, the app still runs (downloads may be blocked).
set -e

if [ -f /opt/pot-provider/build/main.js ]; then
  echo "Starting PO-token provider on 127.0.0.1:4416 ..."
  node /opt/pot-provider/build/main.js >/tmp/pot-provider.log 2>&1 &
fi

exec node server/index.js
