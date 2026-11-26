# Personal source deployment

The source fork preserves Paperclip's MIT license and upstream history. Keep the upstream remote and use a separate enhancement branch for local changes. Run development through the upstream dev commands and use a separate Paperclip home and database.

## Build an immutable release

Use the Node and pnpm versions listed in the root manifest and the Rust toolchain pinned in packages/paperclip-runner. Install Linux build prerequisites for the native Runner. Build outside the development checkout, at the exact absolute location that systemd will use. The runtime bundle preserves absolute paths to build outputs.

```bash
commit=$(git rev-parse HEAD)
release="/srv/paperclip/releases/$commit"
install -d "$release"
git archive "$commit" | tar -x -C "$release"
PAPERCLIP_BUILD_COMMIT="$commit" "$release/scripts/local-deployment/build-release.sh"
```

Use a single pnpm store for all local checkouts and releases on the same filesystem. Set npm_config_store_dir before installing dependencies. The build script retains the runtime, compiled UI and Runner. It drops Rust compiler intermediates from the release snapshot after checking its outputs. On installations with util-linux hardlink, it also consolidates identical immutable Copilot assets within the release while preserving their paths and permissions. Development builds in the source checkout retain their normal cache.

## Run and update

Use the example service and environment as templates. The example uses systemd 257 or later for PrivatePIDs. Install Tini from the host package repository for PID namespace init and child reaping. Configure the actual non-root service identity, filesystem paths, HTTPS origin and database. For first setup, keep the service on loopback and temporarily use the loopback auth origin and signup. Claim the first owner, disable public signup, then change to the private HTTPS origin. The environment file and instance state belong outside Git. Agent OAuth credentials require independent authorization and compatible provider entitlements.

Keep the previous release, take a consistent database and instance backup, and check migration compatibility before updating the current symlink. Start the candidate first against disposable state. On switch-over, verify the precise commit from /api/health, the deployed UI, and anonymous API denial. For a failed code-only update, restore the previous symlink and restart. Rehearse data recovery separately for schema changes. Keep systemd, the HTTPS proxy, backup policy and desktop integration in host-managed configuration.
