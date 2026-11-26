#!/usr/bin/env bash
# Build an archived checkout in its final release directory.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
commit=${PAPERCLIP_BUILD_COMMIT:?Set PAPERCLIP_BUILD_COMMIT to the full source commit}
if [[ ! $commit =~ ^[0-9a-f]{40}$ || -e .git || -f .paperclip-source-commit ]]; then
  printf 'Expected a fresh archived checkout in its final release directory.\n' >&2
  exit 1
fi
unset NODE_ENV
export CI=true GIT_CEILING_DIRECTORIES="$PWD"
pnpm install --frozen-lockfile
pnpm --filter @paperclipai/ui build
pnpm --filter @paperclipai/plugin-sdk build
PAPERCLIP_TSC_EMIT_ONLY=1 pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/server build:runtime

node --check server/dist-runtime/index.mjs
node -e 'require("node:assert/strict").equal(require("./server/dist/build-info.json").commit, process.argv[1])' "$commit"
scripts/local-deployment/trim-build-cache.sh "$PWD"
printf '%s\n' "$commit" > .paperclip-source-commit
