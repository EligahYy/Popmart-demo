#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/tools/node-v24.21.0-darwin-arm64/bin:$PATH"

if ! curl -sf -m 3 http://127.0.0.1:8787/api/health >/dev/null; then
  echo "启动本地服务…"
  (cd "$ROOT/apps/import-server" && HOST=0.0.0.0 PORT=8787 ./node_modules/.bin/tsx src/server.ts > /tmp/my-popmart-server.log 2>&1 &)
  sleep 3
fi

echo "启动 HTTPS 隧道（保持本窗口打开）…"
exec "$ROOT/tools/cloudflared" tunnel --url http://127.0.0.1:8787 --no-autoupdate --protocol http2
