#!/usr/bin/env bash
# Builds E6's base image and its three arms, then prints the digests to pin in design.json.
#
# The base is sandbox/Dockerfile with the current Claude Code release (the published
# season 1 image carried 2.1.280; this experiment's concurrent control carries the release
# installed on the measuring machine on the night). The arms differ only in SHIMS.
#
# HTTP_PROXY_FOR_APT is for a machine whose egress refuses apt's own HTTP client; it is a
# build-time argument only and is not stored in the image.
set -euo pipefail
cd "$(dirname "$0")/../.."
CLI="${CLAUDE_CODE_VERSION:-2.1.321}"
NET=(--network host)
PROXY=()
[ -n "${HTTP_PROXY_FOR_APT:-}" ] && PROXY=(--build-arg "http_proxy=${HTTP_PROXY_FOR_APT}")
BASE_PATH="/opt/python/bin:/usr/local/go/bin:/usr/lib/postgresql/15/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

docker image inspect aeo-sandbox:e6-base >/dev/null 2>&1 || \
  docker build "${NET[@]}" "${PROXY[@]}" --build-arg CLAUDE_CODE_VERSION="$CLI" -t aeo-sandbox:e6-base sandbox/

build_arm() {
  docker build "${NET[@]}" -f sandbox/Dockerfile.arm \
    --build-arg BASE_IMAGE=aeo-sandbox:e6-base --build-arg SHIMS="$1" --build-arg ARM_PATH="$2" \
    -t "aeo-sandbox:e6-$1" sandbox/ >/dev/null
}
build_arm named   "/opt/shims:${BASE_PATH}"
build_arm neutral "/usr/local/libexec/bin:${BASE_PATH}"
build_arm none    "${BASE_PATH}"

for t in e6-base e6-named e6-neutral e6-none; do
  printf '%-12s %s  %s\n' "$t" "$(docker image inspect --format '{{.Id}}' aeo-sandbox:$t)" \
    "$(docker run --rm aeo-sandbox:$t claude --version)"
done
