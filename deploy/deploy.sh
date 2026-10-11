#!/usr/bin/env bash
# Builds the current checkout into releases/<commit>-<timestamp>, runs migrations, and switches the pm2 app to it.
# The previous release keeps running until the new one is fully built, so a failed build causes no downtime.
#
# Run it from a clone of this repo on the server, with a .env file in the repo root (see .env.example).
# Usually invoked via deploy/auto-update.sh, which pulls new commits first.

# Wrapped in a function so that bash parses the whole file before running it, in case it changes during a deploy
main() {
  set -euo pipefail

  cd "$(dirname "$0")/.."
  local root
  root="$(pwd)"

  if [ ! -f .env ]; then
    echo "Missing .env file in ${root}. Copy .env.example and fill it in." >&2
    exit 1
  fi

  local commit version release_name release
  commit="$(git rev-parse --short HEAD)"
  version="${VERSION:-$(git describe --tags --always)}"
  release_name="${commit}-$(date +%Y%m%d%H%M%S)"
  release="${root}/releases/${release_name}"
  echo "Building version ${version} into ${release}"

  npm ci
  # Builds into build/ and installs production dependencies there
  VERSION="${version}" node --run build:dist
  cp tsconfig.json build/
  mkdir -p releases
  cp -a build "${release}"

  # `node --run` does not pass --env-file vars to scripts, so the migrations CLI is invoked directly
  (cd "${release}" && node --env-file="${root}/.env" ./node_modules/tsx/dist/cli.mjs \
    ./node_modules/@mikro-orm/cli/cli.js migration:up --config ./migrations.config.ts)

  # Atomically point current/ to the new release
  ln -sfn "releases/${release_name}" current.tmp
  mv -Tf current.tmp current

  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save

  # Keep the 3 most recent releases, to be able to roll back
  ls -1dt releases/*/ | tail -n +4 | xargs -r rm -rf

  echo "Deployed ${version}"
}

main "$@"
exit
