#!/usr/bin/env bash
# Post-deploy smoke check for CrooHQ edge functions.
#
# Why this exists: a type-check failure in ONE function can block its deploy,
# leaving the edge serving a stale build while the repo source looks correct.
# Never claim "fixed and deployed" without a live signal. Run this after any
# edge function change.
#
#   bash scripts/verify-edge-deploys.sh
#
# Step 1 — type-check every function locally (catches deploy blockers).
# Step 2 — probe each auth-guarded function unauthenticated; expect HTTP 401.

set -uo pipefail

PROJECT_URL="https://lmodeiyrpwvgyqcvjkjr.supabase.co"
FN_DIR="supabase/functions"

# Functions that use the shared callerAuth guard (service-role key or verified JWT).
GUARDED=(
  alert-push-sender
  aloha-service
  auth-email-hook
  clover-service
  email-batch-sender
  email-queue-sender
  hiring-email-service
  maintenance-queue-processor
  ovation-service
  pfg-service
  produce-alliance-service
  send-notification-email
  send-report-email
  send-weekly-schedule-email
  support-email-service
  send-push-notification
  user-service
)

fail=0

echo "=== 1. Type-check (deploy blockers) ==="
for dir in "$FN_DIR"/*/; do
  name=$(basename "$dir")
  [ -f "$dir/index.ts" ] || continue
  out=$(deno check --no-lock "$dir/index.ts" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  # TS2307 on the npm: cors specifier is a local-resolution artifact; that
  # module resolves fine in the deployed edge runtime. Ignore only that one.
  real=$(echo "$out" | grep -E '^TS[0-9]+' | grep -v "Cannot find module 'npm:@supabase/supabase-js@2/cors'")
  if [ -n "$real" ]; then
    echo "FAIL  $name"
    echo "$real" | head -3
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "all functions type-check clean"

echo
echo "=== 2. Live auth probe (expect 401) ==="
for f in "${GUARDED[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 25 \
    -X POST "$PROJECT_URL/functions/v1/$f" \
    -H "Content-Type: application/json" -d '{}')
  if [ "$code" = "401" ]; then
    printf "ok    %-32s 401\n" "$f"
  else
    printf "FAIL  %-32s %s (expected 401)\n" "$f" "$code"
    fail=1
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS — source compiles and the live edge is enforcing auth."
else
  echo "FAIL — do NOT claim deployed. Fix the above and re-run."
fi
exit "$fail"
