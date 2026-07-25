#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Erreur : Node.js 22 et npm sont requis."
  exit 1
fi

if [ ! -f backend/.env ]; then
  echo "Erreur : backend/.env est absent."
  echo "Créez-le avec : sh scripts/init-env.sh --development"
  exit 1
fi

if [ ! -d backend/node_modules ] || [ ! -d frontend/node_modules ]; then
  echo "Erreur : les dépendances ne sont pas installées."
  echo "Exécutez npm ci dans backend puis dans frontend."
  exit 1
fi

port_is_open() {
  node -e "const net=require('net');const s=net.createConnection({host:'127.0.0.1',port:Number(process.argv[1])});s.once('connect',()=>{s.destroy();process.exit(0)});s.once('error',()=>process.exit(1));setTimeout(()=>process.exit(1),500)" "$1"
}

for port in 3001 5173; do
  if port_is_open "$port"; then
    echo "Erreur : le port $port est déjà utilisé. Arrêtez le service concerné puis réessayez."
    exit 1
  fi
done

echo "Démarrage du backend sur http://localhost:3001"
(cd backend && npm run dev) &
BACKEND_PID=$!

echo "Démarrage du frontend sur http://localhost:5173"
(cd frontend && npm run dev) &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 3
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:5173 >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open http://localhost:5173 >/dev/null 2>&1 || true
fi

echo "ComfyForge est prêt. Utilisez Ctrl+C pour arrêter les deux services."
wait "$BACKEND_PID" "$FRONTEND_PID"
