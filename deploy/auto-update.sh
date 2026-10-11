#!/usr/bin/env bash
# Deploys when the tracked branch has new commits. Meant to run periodically from cron.
# Pass --force to deploy even if there are no new commits.

# Wrapped in a function so that bash parses the whole file before running it, as it may change with the pulled commits
main() {
  set -euo pipefail

  cd "$(dirname "$0")/.."

  # Skip if another deploy is in progress
  exec 9> .deploy.lock
  if ! flock -n 9; then
    echo "Another deploy is in progress" >&2
    exit 0
  fi

  git fetch --quiet
  local local_commit remote_commit
  local_commit="$(git rev-parse HEAD)"
  remote_commit="$(git rev-parse '@{u}')"

  if [ "${local_commit}" = "${remote_commit}" ] && [ "${1:-}" != "--force" ]; then
    exit 0
  fi

  echo "$(date -Is) Deploying ${remote_commit} (currently on ${local_commit})"
  git merge --ff-only --quiet '@{u}'
  if bash deploy/deploy.sh; then
    echo "$(date -Is) Deploy succeeded"
  else
    echo "$(date -Is) Deploy FAILED. The previous release is still running" >&2
    exit 1
  fi
}

main "$@"
exit
