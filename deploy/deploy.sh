#!/usr/bin/env bash
# Builds and (re)starts Shlink Dashboard with pm2. Run it from a clone of this repo on the server, with a .env file in
# the repo root (see .env.example).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env file in $(pwd). Copy .env.example and fill it in." >&2
  exit 1
fi

git pull --ff-only
VERSION="${VERSION:-$(git describe --tags --always)}"
echo "Deploying version ${VERSION}"

npm ci
# Builds into build/ and installs production dependencies there
VERSION="${VERSION}" node --run build:dist
cp tsconfig.json build/

# `node --run` does not pass --env-file vars to scripts, so the migrations CLI is invoked directly
(cd build && node --env-file=../.env ./node_modules/tsx/dist/cli.mjs ./node_modules/@mikro-orm/cli/cli.js \
  migration:up --config ./migrations.config.ts)

pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
