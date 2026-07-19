#!/bin/bash
# Double-click to launch ShotLab (API + frontend) locally.
cd "$(dirname "$0")"

echo "Starting ShotLab..."

# 1) API
cd server
if [ ! -d node_modules ]; then
  echo "Installing API dependencies (first run)..."
  npm install --omit=optional
  npx prisma generate
  npx prisma db push
  node prisma/seed.mjs
fi
node src/index.js &
API_PID=$!
cd ..

# 2) Frontend
sleep 2
cd web
node serve.mjs &
WEB_PID=$!
cd ..

sleep 1
open "http://localhost:5173"

echo ""
echo "ShotLab is running:"
echo "  API      → http://localhost:4000"
echo "  Frontend → http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
