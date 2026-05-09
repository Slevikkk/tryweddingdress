#!/usr/bin/env bash
# =============================================================================
# build-static-frontend.sh
#
# Cloudflare Pages serves only files inside frontend/. This script copies the
# catalog images and example before/after photos into frontend/ so they get
# uploaded with the next `wrangler pages deploy frontend ...` call.
#
# We do NOT commit the copied files to git (see .gitignore) — they're a
# materialised view of catalog/ and website_examples/, which already live in
# the repo as the source of truth.
#
# Usage:
#   bash scripts/build-static-frontend.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Syncing catalog images into frontend/catalog-images/"
mkdir -p frontend/catalog-images
cp -u catalog/*.jpg frontend/catalog-images/

echo "→ Syncing examples into frontend/examples/"
mkdir -p frontend/examples
cp -ru website_examples/example_01 frontend/examples/
cp -ru website_examples/example_02 frontend/examples/

echo "✓ Done. Now run:"
echo "   CLOUDFLARE_ACCOUNT_ID=2800aa08dc342b00dafd8b561c922e2c \\"
echo "   wrangler pages deploy frontend --project-name=tryweddingdress \\"
echo "     --branch=initial-import --commit-dirty=true"
