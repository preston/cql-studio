#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/images-build-and-push.sh [extra-tag]
# Always builds and pushes :latest. If an extra tag is provided, also tags and pushes that tag.

EXTRA_TAG="${1:-}"

build_and_push() {
  local dockerfile="$1"
  local image="$2"
  local tags=(-t "${image}:latest")
  if [[ -n "${EXTRA_TAG}" ]]; then
    tags+=(-t "${image}:${EXTRA_TAG}")
  fi
  docker buildx build --platform linux/arm64,linux/amd64 -f "${dockerfile}" "${tags[@]}" . --push
}

build_and_push ui/Dockerfile hlseven/quality-cql-studio
build_and_push server/Dockerfile hlseven/quality-cql-studio-server
build_and_push opencode/Dockerfile hlseven/quality-cql-studio-opencode
