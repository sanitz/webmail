#!/usr/bin/env bash
# Throwaway Stalwart for the fork's E2E specs (tiger-iac#1754), run with
# rootless podman: the image production runs (STALWART_IMAGE, the digest
# tiger-iac pins), upstream's declarative bootstrap from integration/stalwart
# (accounts alice/bob/carol@example.org, password test-pass-123, permissive
# CORS), no volume: `down` leaves nothing behind.
#
#   e2e-fork/stalwart.sh up     build, start, wait until JMAP answers
#   e2e-fork/stalwart.sh down   stop and remove
set -euo pipefail

STALWART_IMAGE="${STALWART_IMAGE:-docker.io/stalwartlabs/stalwart:v1.1.0@sha256:0aacd114054f56c34e98063140e2102a04dc0bcb4933ff08925cf8e9938b0d16}"
# The stalwart-cli production uses (tiger-iac stalwart_cli_image); upstream's
# default 1.0.6 cannot read the schema of server 1.0.3.
export STALWART_CLI_VERSION="${STALWART_CLI_VERSION:-1.0.14}"
NAME=bulwark-e2e-stalwart
TAG=localhost/bulwark-e2e-stalwart:latest
PORT="${E2E_JMAP_PORT:-8025}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CTX="${HERE}/../integration/stalwart"

up() {
  "${CTX}/prepare-stalwart-cli.sh" >&2
  # Upstream's plans target 0.16; 1.0.3 renamed some fields. A staged copy
  # keeps integration/ untouched for rebases.
  local stage="${HERE}/.build/stalwart"
  rm -rf "${stage}" && mkdir -p "${stage}" && cp -a "${CTX}/." "${stage}/"
  sed -i 's/"serverHostname"/"defaultHostname"/' "${stage}/plan-bootstrap.ndjson"
  # The specs need JMAP and CalDAV only: no SMTP/IMAP listeners, whose
  # schema 1.0.3 changed too.
  grep -v -E '"object":"(NetworkListener|MtaStageAuth|Imap)"' "${CTX}/plan-accounts.ndjson.tpl" > "${stage}/plan-accounts.ndjson.tpl"
  podman build -q --format docker --build-arg "STALWART_IMAGE=${STALWART_IMAGE}" -t "${TAG}" "${stage}" >/dev/null
  podman rm -f "${NAME}" >/dev/null 2>&1 || true
  podman run -d --name "${NAME}" -p "127.0.0.1:${PORT}:8080" \
    -e STALWART_RECOVERY_ADMIN=admin:bootstrap-secret \
    -e TEST_ACCOUNT_PASSWORD=test-pass-123 \
    "${TAG}" >/dev/null
  for _ in $(seq 1 90); do
    [ "$(podman inspect -f '{{.State.Running}}' "${NAME}" 2>/dev/null)" = true ] || break
    # The bootstrap answers JMAP too, then stops for the final instance:
    # only that one counts.
    podman logs "${NAME}" 2>&1 | grep -q 'Starting Stalwart (final, foreground)' || { sleep 2; continue; }
    if curl -fsS -u alice@example.org:test-pass-123 "http://127.0.0.1:${PORT}/jmap/session" >/dev/null 2>&1; then
      echo "stalwart up on http://127.0.0.1:${PORT}" >&2
      return 0
    fi
    sleep 2
  done
  podman logs --tail 40 "${NAME}" 2>&1 | grep -v HEALTHCHECK >&2 || true
  echo "stalwart did not come up" >&2
  return 1
}

down() { podman rm -f "${NAME}" >/dev/null 2>&1 || true; }

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
