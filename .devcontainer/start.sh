#!/bin/sh
# Installs, builds and starts the game if needed. Safe to run any number of times.
cd "$(dirname "$0")/.." || exit 1

[ -d node_modules ] || npm install
[ -f public/index.html ] || npm run build

PORT="${PORT:-3003}"

if node -e "require('http').get('http://localhost:$PORT/api/status', () => process.exit(0)).on('error', () => process.exit(1))"; then
    echo "openScope is already running on port $PORT"
else
    setsid nohup npm run start > /tmp/openscope.log 2>&1 < /dev/null &
    echo "openScope is starting on port $PORT (log: /tmp/openscope.log)"
fi
