#!/usr/bin/env bash
# One-shot deploy of the hardened edge functions to the PoolPro Supabase project.
#
# Why this script exists: the Supabase CLI on this machine is logged into an
# account that gets a 403 ("insufficient privileges") on this project's Functions
# API, so an assistant/CI can't deploy for you. Once YOU are authenticated as an
# owner/admin of the project's org, this deploys all six in one go.
#
# ── One-time prerequisites ────────────────────────────────────────────────
#   1. npx supabase login
#        → opens a browser; sign in as the account that OWNS this Supabase
#          project (org owner/admin). This caches an access token locally.
#   2. That's it — --use-api below bundles server-side, so Docker is NOT needed.
#
# ── Run ───────────────────────────────────────────────────────────────────
#   bash scripts/deploy-edge-functions.sh
#
# If you still get a 403 after `supabase login`, your account isn't an
# owner/admin of the project's org — either switch accounts or have the owner
# add you, then re-run. (Nothing here needs your service-role key or any secret.)

set -euo pipefail

REF="tdeytachcvjehlunlsue"

# All six run with the default gateway JWT check EXCEPT portal-auth, which is a
# public (anonymous) endpoint gated by capability tokens in code.
JWT_FUNCS=(complete-service unable-service send-quote trigger-automation set-staff-password)

for f in "${JWT_FUNCS[@]}"; do
  echo "── Deploying $f ─────────────────────────────────────"
  npx --no-install supabase functions deploy "$f" --project-ref "$REF" --use-api
done

echo "── Deploying portal-auth (public / no gateway JWT) ──"
npx --no-install supabase functions deploy portal-auth --project-ref "$REF" --use-api --no-verify-jwt

echo "── Deleting dead function update-job-status ─────────"
npx --no-install supabase functions delete update-job-status --project-ref "$REF" || echo "(already removed)"

echo "✅ Edge functions deployed."
