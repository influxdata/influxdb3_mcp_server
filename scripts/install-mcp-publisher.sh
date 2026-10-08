#!/usr/bin/env bash
set -euo pipefail

# Pinned Linux amd64 build for the ubuntu-latest CI and release runners.
# Checksum from the v1.8.1 release's registry_1.8.1_checksums.txt.
destination="${1:?Usage: bash scripts/install-mcp-publisher.sh DESTINATION}"
publisher_version="1.8.1"
publisher_sha256="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc"
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT

curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/modelcontextprotocol/registry/releases/download/v${publisher_version}/mcp-publisher_linux_amd64.tar.gz" \
  --output "$download_dir/mcp-publisher.tar.gz"
echo "$publisher_sha256  $download_dir/mcp-publisher.tar.gz" | sha256sum --check
tar -xzf "$download_dir/mcp-publisher.tar.gz" -C "$download_dir" mcp-publisher
install -m 0755 "$download_dir/mcp-publisher" "$destination"
