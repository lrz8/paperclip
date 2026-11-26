#!/usr/bin/env bash
# Drop Rust compiler intermediates after packaging, retaining staged and fallback binaries.
set -euo pipefail

if [[ $# != 1 ]]; then
  printf 'Usage: %s /absolute/path/to/built-release\n' "$0" >&2
  exit 2
fi
release=$(realpath -e -- "$1")
if [[ -e $release/.git || ! -s $release/server/dist/build-info.json || ! -s $release/server/dist-runtime/index.mjs ||
      ! -s $release/ui/dist/index.html || ! -x $release/server/dist/vendor/paperclip-runner/bin/paperclip-runnerd ]]; then
  printf 'Expected a built source release with its vendored Runner and static UI.\n' >&2
  exit 1
fi
target="$release/packages/paperclip-runner/runner/target/release"
for name in build deps incremental .fingerprint; do
  directory="$target/$name"
  [[ -d $directory ]] || continue
  if [[ $(realpath -e -- "$directory") != "$directory" ]]; then
    printf 'Skipping unexpected symlink: %s\n' "$directory" >&2
    exit 1
  fi
  find -P "$directory" -xdev -depth -delete
done

# The build materializes the same immutable Copilot payload in two package paths.
runner_assets="$release/packages/paperclip-runner/provider-assets/copilot"
server_assets="$release/server/provider-assets/copilot"
if command -v hardlink >/dev/null && [[ -d $runner_assets && -d $server_assets ]] &&
   [[ $(realpath -e -- "$runner_assets") == "$runner_assets" && $(realpath -e -- "$server_assets") == "$server_assets" ]]; then
  hardlink --ignore-time --respect-name --respect-xattrs --mount --reflink=never "$runner_assets" "$server_assets"
fi
