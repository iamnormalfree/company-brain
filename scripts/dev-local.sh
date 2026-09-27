#!/usr/bin/env bash
# Local dev helper for the iamnormalfree fork.
#
# `bun run dev` alone won't authenticate wrangler. This script sources
# .env.dev (which holds CLOUDFLARE_API_TOKEN) and then runs `bun run dev`.
#
# Usage:  bun scripts/dev-local.sh
#
# Not part of upstream supermemoryai/company-brain — fork-only helper.

set -euo pipefail

# Always source from the repo root so this works regardless of cwd.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ ! -f .env.dev ]; then
	echo "missing .env.dev — copy .env.dev.example (or fill in CLOUDFLARE_API_TOKEN)" >&2
	exit 1
fi

# Bail loudly if the token is still the empty placeholder.
if grep -Eq '^CLOUDFLARE_API_TOKEN=""$' .env.dev; then
	echo "CLOUDFLARE_API_TOKEN is empty in .env.dev" >&2
	echo "paste a scoped token (Workers Scripts: Edit + Workers AI: Read + D1: Edit + KV: Edit)" >&2
	echo "from https://dash.cloudflare.com/profile/api-tokens" >&2
	exit 1
fi

# Export everything from .env.dev so wrangler picks it up. Using `set -a` so we
# don't have to prefix each variable with `export`.
set -a
# shellcheck disable=SC1091
source .env.dev
set +a

exec bun run dev "$@"
