#!/usr/bin/env bash
# Throwaway Stalwart for the fork's E2E specs (tiger-iac#1754), run with
# rootless podman: the image production runs (STALWART_IMAGE, the digest
# tiger-iac pins), upstream's declarative bootstrap from integration/stalwart
# (accounts alice/bob/carol@example.org, password test-pass-123, permissive
# CORS), no volume: `down` leaves nothing behind.
#
#   e2e-fork/stalwart.sh up     build, start, wait until JMAP answers
#   e2e-fork/stalwart.sh down   stop and remove
#   e2e-fork/stalwart.sh image  the image `up` runs (see resolve_image)
set -euo pipefail

# Fallback only: the image production pins is read from a tiger-iac checkout
# (TIGER_IAC_DIR, default ~/tiger-iac), so a Stalwart update there reaches
# the specs without a second edit here (tiger-iac#1820).
DEFAULT_STALWART_IMAGE="docker.io/stalwartlabs/stalwart:v1.1.0@sha256:0aacd114054f56c34e98063140e2102a04dc0bcb4933ff08925cf8e9938b0d16"

# The image to run: STALWART_IMAGE if set, else production's pin, else the
# built-in default with a warning that it may lag production.
resolve_image() {
  if [ -n "${STALWART_IMAGE:-}" ]; then echo "${STALWART_IMAGE}"; return; fi
  local iac="${TIGER_IAC_DIR:-${HOME}/tiger-iac}" pinned
  pinned="$(sed -n 's/^stalwart_image: *//p' "${iac}/roles/stalwart/defaults/main.yml" 2>/dev/null | head -1 || true)"
  if [ -n "${pinned}" ]; then
    [ "${pinned}" = "${DEFAULT_STALWART_IMAGE}" ] \
      || echo "note: production pins ${pinned}; the built-in default here is older, update it" >&2
    echo "${pinned}"
  else
    echo "WARNING: no tiger-iac checkout at ${iac}: running the built-in ${DEFAULT_STALWART_IMAGE}, which may lag production" >&2
    echo "${DEFAULT_STALWART_IMAGE}"
  fi
}
# Production pins its own platform's digest (amd64). On another host the
# same release runs as the tag's manifest entry for this architecture, after
# checking that the pinned digest belongs to that tag (tiger-iac#1922).
native_image() {
  local image="$1" repo tag digest arch native
  case "${image}" in *@sha256:*) ;; *) echo "${image}"; return ;; esac
  repo="${image%%:*}"; tag="${image#*:}"; tag="${tag%%@*}"; digest="${image##*@}"
  arch="$(podman info --format '{{.Host.Arch}}')"
  native="$(podman manifest inspect "${repo}:${tag}" | python3 -c '
import json, sys
pinned, arch = sys.argv[1], sys.argv[2]
entries = json.load(sys.stdin).get("manifests", [])
if not any(e["digest"] == pinned for e in entries):
    sys.exit(f"pinned {pinned} is not part of the tag manifest")
print(next((e["digest"] for e in entries if e.get("platform", {}).get("architecture") == arch), pinned))
' "${digest}" "${arch}")" || return 1
  [ "${native}" = "${digest}" ] || echo "note: running ${tag} for ${arch} (${native}); production pins ${digest}" >&2
  echo "${repo}:${tag}@${native}"
}

# The stalwart-cli production uses (tiger-iac stalwart_cli_image); upstream's
# default 1.0.6 cannot read the schema of server 1.0.3.
export STALWART_CLI_VERSION="${STALWART_CLI_VERSION:-1.0.14}"
NAME=bulwark-e2e-stalwart
TAG=localhost/bulwark-e2e-stalwart:latest
PORT="${E2E_JMAP_PORT:-8025}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CTX="${HERE}/../integration/stalwart"

# OAuth client for the app on E2E_WEB_PORT; secret shared with run.sh.
E2E_OAUTH_CLIENT_ID=bulwark-webmail
E2E_OAUTH_CLIENT_SECRET=e2e-oauth-client-secret-not-real
WEB_PORT="${E2E_WEB_PORT:-3100}"

oauth_client() {
  local web="http://localhost:${WEB_PORT}" uris="" loc
  for loc in $(ls "${HERE}/../locales"); do
    uris="${uris}${uris:+,}\"${web}/${loc}/auth/callback\":true"
  done
  printf '{"@type":"create","object":"OAuthClient","value":{"webmail":{"clientId":"%s","description":"Bulwark Webmail (E2E)","secret":"%s","redirectUris":{%s},"postLogoutRedirectUris":{"%s/login":true},"scopes":{"mail":true,"contacts":true,"calendars":true,"files":true,"security":true,"settings":true}}}}\n' \
    "${E2E_OAUTH_CLIENT_ID}" "${E2E_OAUTH_CLIENT_SECRET}" "${uris}" "${web}"
}

up() {
  local image
  image="$(native_image "$(resolve_image)")"
  echo "stalwart image: ${image}" >&2
  "${CTX}/prepare-stalwart-cli.sh" >&2
  # Upstream's plans target 0.16; 1.0.3 renamed some fields. A staged copy
  # keeps integration/ untouched for rebases.
  local stage="${HERE}/.build/stalwart"
  rm -rf "${stage}" && mkdir -p "${stage}" && cp -a "${CTX}/." "${stage}/"
  sed -i 's/"serverHostname"/"defaultHostname"/' "${stage}/plan-bootstrap.ndjson"
  # The specs need JMAP and CalDAV only: no SMTP/IMAP listeners, whose
  # schema 1.0.3 changed too.
  grep -v -E '"object":"(NetworkListener|MtaStageAuth|Imap)"' "${CTX}/plan-accounts.ndjson.tpl" > "${stage}/plan-accounts.ndjson.tpl"
  # The webmail's SSO client (tiger-iac#1922), as production's Stalwart plan
  # declares it: one callback per locale, the login page after sign-out, the
  # data scopes plus the account's security and settings.
  oauth_client >> "${stage}/plan-accounts.ndjson.tpl"
  podman build -q --format docker --build-arg "STALWART_IMAGE=${image}" -t "${TAG}" "${stage}" >/dev/null
  podman rm -f "${NAME}" >/dev/null 2>&1 || true
  podman run -d --name "${NAME}" -p "127.0.0.1:${PORT}:8080" \
    -e STALWART_RECOVERY_ADMIN=admin:bootstrap-secret \
    -e TEST_ACCOUNT_PASSWORD=test-pass-123 \
    -e STALWART_PUBLIC_URL="http://localhost:${PORT}" \
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
  image) resolve_image ;;
  oauth-client) oauth_client ;;
  *) echo "usage: $0 up|down|image" >&2; exit 2 ;;
esac
