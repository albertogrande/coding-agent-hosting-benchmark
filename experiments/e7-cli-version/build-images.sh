#!/usr/bin/env bash
# Builds E7's two arms from the E6 named image, swapping only the Claude Code release.
# Digests are printed to pin in design.json. Dockerfile.season is the existing
# "same sandbox, different CLI" file; the base is aeo-sandbox:e6-named (published
# shims, the instrument E6 kept), digest checked against the pin below.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE=aeo-sandbox:e6-named
BASE_DIGEST=sha256:83a99a545ae5301805687f6e3848983e21eaf4c96cdc1d6f4548aada482ab96e
NET=(--network host)

got=$(docker image inspect --format '{{.Id}}' "$BASE")
if [ "$got" != "$BASE_DIGEST" ]; then
  echo "base $BASE is $got, expected $BASE_DIGEST" >&2
  exit 1
fi

build() {
  local ver=$1 tag=$2
  docker build "${NET[@]}" -f sandbox/Dockerfile.season \
    --build-arg BASE_IMAGE="$BASE" \
    --build-arg CLAUDE_CODE_VERSION="$ver" \
    -t "$tag" sandbox/
}

build 2.1.280 aeo-sandbox:e7-v280
build 2.1.321 aeo-sandbox:e7-v321

for t in e7-v280 e7-v321; do
  printf '%-12s %s  %s\n' "$t" "$(docker image inspect --format '{{.Id}}' aeo-sandbox:$t)" \
    "$(docker run --rm aeo-sandbox:$t claude --version)"
done
