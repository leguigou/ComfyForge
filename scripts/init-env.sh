#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(dirname -- "$SCRIPT_DIR")

if [ "${1:-}" = "--development" ]; then
  TARGET="$PROJECT_ROOT/backend/.env"
  DEFAULT_COMFY_URL="http://127.0.0.1:8188"
else
  TARGET="$PROJECT_ROOT/.env"
  DEFAULT_COMFY_URL="http://host.docker.internal:8188"
fi

if [ -f "$TARGET" ]; then
  echo "Le fichier $TARGET existe déjà. Aucune modification effectuée."
  exit 0
fi

while :; do
  printf 'Mot de passe du premier administrateur (12 caractères minimum) : '
  stty -echo
  IFS= read -r ADMIN_PASSWORD
  stty echo
  printf '\n'
  if [ "${#ADMIN_PASSWORD}" -ge 12 ]; then
    break
  fi
  echo 'Le mot de passe doit contenir au moins 12 caractères.'
done

printf 'URL de ComfyUI [%s] : ' "$DEFAULT_COMFY_URL"
IFS= read -r COMFY_URL
COMFY_URL=${COMFY_URL:-$DEFAULT_COMFY_URL}

if command -v openssl >/dev/null 2>&1; then
  AUTH_SECRET=$(openssl rand -hex 48)
else
  AUTH_SECRET=$(od -An -N48 -tx1 /dev/urandom | tr -d ' \n')
fi

escape_dotenv() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

umask 077
{
  printf 'APP_PASSWORD="%s"\n' "$(escape_dotenv "$ADMIN_PASSWORD")"
  printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET"
  printf 'COMFY_URL="%s"\n' "$(escape_dotenv "$COMFY_URL")"
  printf 'FRONTEND_PORT=5173\n'
  printf 'CORS_ORIGINS=\n'
  printf 'SERVICE_URL_ALLOWLIST=\n'
  printf 'ALLOW_PRIVATE_SERVICE_URLS=false\n'
  printf 'ALLOW_USER_LLM_URLS=false\n'
} > "$TARGET"

unset ADMIN_PASSWORD AUTH_SECRET
echo "Configuration créée dans $TARGET"
echo 'Conservez ce fichier privé : il est ignoré par Git.'
