#!/usr/bin/env bash
# One-shot run of the fork's E2E specs (tiger-iac#1754):
#   1. throwaway Stalwart (image production runs), see stalwart.sh
#   2. the app in `next dev` on the host, pointed at it
#   3. Playwright in the official container (browsers and their system
#      libraries inside, host network to reach 1 and 2)
#   4. teardown of 1 and 2, also on failure
#
#   e2e-fork/run.sh [playwright args, e.g. a spec name]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
PORT="${E2E_WEB_PORT:-3100}"
JMAP_PORT="${E2E_JMAP_PORT:-8025}"
PW_VERSION="$(cd "${ROOT}" && node -p "require('@playwright/test/package.json').version")"
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
# Run output lives outside the repo: next dev watches the tree, and every
# trace or log line written there recompiles and reloads the page under test.
OUT="${E2E_OUT_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/bulwark-e2e}"
rm -rf "${OUT}/test-results" && mkdir -p "${OUT}"
DEV_LOG="${OUT}/dev.log"
DEV_PID=

cleanup() {
  if [ -n "${DEV_PID}" ]; then
    # npm starts next as a child: stop the whole process group.
    kill -TERM -- "-${DEV_PID}" 2>/dev/null || kill -TERM "${DEV_PID}" 2>/dev/null || true
  fi
  [ -n "${E2E_KEEP_STALWART:-}" ] || "${HERE}/stalwart.sh" down
}
trap cleanup EXIT

[ -n "${E2E_KEEP_STALWART:-}" ] || "${HERE}/stalwart.sh" up

echo "== app on http://localhost:${PORT} (log ${DEV_LOG})" >&2
(
  cd "${ROOT}"
  JMAP_SERVER_URL="http://localhost:${JMAP_PORT}" \
  SESSION_SECRET=e2e-not-a-real-secret-at-least-32-chars \
  STALWART_FEATURES=true \
  SETTINGS_DATA_DIR="${OUT}/data/settings" \
  ADMIN_DATA_DIR="${OUT}/data/admin" \
  TELEMETRY_DATA_DIR="${OUT}/data/telemetry" \
  VERSION_CHECK_DATA_DIR="${OUT}/data/version-check" \
    exec setsid npm run dev -- -p "${PORT}"
) >"${DEV_LOG}" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 120); do
  curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1 && break
  kill -0 "${DEV_PID}" 2>/dev/null || { tail -30 "${DEV_LOG}" >&2; exit 1; }
  sleep 2
done
# A browser that hits a freshly started `next dev` sets off a loop of
# recompiles and reloads; one that comes once it is quiet does not. So: compile
# the pages once, then wait for 20 s without a new compile (at most 3 min).
for page in / /login /calendar; do curl -fsS -o /dev/null --max-time 240 "http://localhost:${PORT}${page}" || true; done
quiet=0; last=-1
for _ in $(seq 1 36); do
  now=$(grep -c 'Compiled' "${DEV_LOG}" || true)
  if [ "${now}" = "${last}" ]; then quiet=$((quiet + 5)); else quiet=0; last=${now}; fi
  [ "${quiet}" -ge 20 ] && break
  sleep 5
done

echo "== playwright ${PW_VERSION} in ${PW_IMAGE}" >&2
podman run --rm --network host --ipc host \
  -v "${ROOT}:/work:Z" -v "${OUT}:/out:Z" -w /work \
  -e E2E_OUT_DIR=/out -e E2E_DEBUG="${E2E_DEBUG:-}" \
  -e E2E_KEEP_STALWART=1 -e E2E_WEB_PORT="${PORT}" -e E2E_JMAP_PORT="${JMAP_PORT}" -e CI=1 \
  "${PW_IMAGE}" \
  npx playwright test -c e2e-fork/playwright.config.ts "$@"
