#!/bin/sh
# Launch the PO-token provider (if present) in the background, then the web app.
# The provider lets yt-dlp pass YouTube's bot check from a datacenter IP without
# any login. If it fails to start, the app still runs (downloads may be blocked).
set -e

if [ -f /opt/pot-provider/build/main.js ]; then
  echo "Starting PO-token provider on 127.0.0.1:4416 ..."
  # Prefix the provider's output so it's distinguishable in the platform logs.
  node /opt/pot-provider/build/main.js 2>&1 | sed -u 's/^/[pot-provider] /' &
else
  echo "WARNING: PO-token provider not found; YouTube bot checks may not clear."
fi

exec node server/index.js
