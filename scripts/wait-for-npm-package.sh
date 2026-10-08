#!/usr/bin/env bash
# npm can accept a publish before validation makes the version publicly available.
set -euo pipefail

package="$(jq -r '.packages[] | select(.registryType == "npm") | .identifier' server.json)"
version="$(jq -r '.version' server.json)"
mcp_name="$(jq -r '.name' server.json)"
encoded_package="$(jq -rn --arg package "$package" '$package | @uri')"
metadata="$(mktemp)"
trap 'rm -f "$metadata"' EXIT

for attempt in $(seq 1 40); do
  status="$(curl --silent --show-error --connect-timeout 5 --max-time 10 \
    --output "$metadata" --write-out '%{http_code}' \
    "https://registry.npmjs.org/$encoded_package/$version")" || status=000

  if [[ "$status" == 200 ]]; then
    jq --exit-status --arg package "$package" --arg version "$version" --arg name "$mcp_name" \
      '.name == $package and .version == $version and .mcpName == $name' "$metadata" >/dev/null || {
      echo "npm metadata does not match the expected package, version, and mcpName" >&2
      exit 1
    }
    echo "$package@$version is publicly available with matching MCP metadata"
    exit 0
  fi

  case "$status" in
    000|404|429|5??) echo "Waiting for $package@$version (attempt $attempt/40; HTTP $status)" ;;
    *) echo "Unexpected npm registry response: HTTP $status" >&2; exit 1 ;;
  esac
  if [[ "$attempt" -lt 40 ]]; then sleep 30; fi
done

echo "npm version is not publicly available yet; retry only the MCP Registry job after npm validation completes" >&2
exit 1
