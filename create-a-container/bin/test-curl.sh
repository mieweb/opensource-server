#!/bin/bash

set -euo pipefail

# Usage function
usage() {
    cat <<EOF
Usage: $0 <hostname> <ipv4Address> <username> <osRelease> <containerId> <macAddress> <aiContainer> <httpPort> [additionalProtocols]

Register a container via the API endpoint.

Required Parameters:
  hostname            Container hostname
  ipv4Address         IPv4 address of the container
  username            Username/owner of the container
  osRelease           Operating system release (e.g., debian, rocky)
  containerId         Container ID (CTID)
  macAddress          MAC address of the container
  aiContainer         AI container type (N, PHOENIX, or FORTWAYNE)
  httpPort            HTTP port

Optional Parameters:
  additionalProtocols Comma-separated list of additional protocol names

Environment Variables:
  CONTAINER_API_URL   Override the API endpoint URL
                      (default: http://localhost:3000/containers)

Examples:
  # Basic registration
  $0 test-container 10.15.7.7 rgingras debian 123 AA:BB:CC:DD:EE:FF N 2222 80

  # With additional protocols
  $0 test-container 10.15.7.7 rgingras debian 123 AA:BB:CC:DD:EE:FF N 2222 80 "dns,smtp" "5353,2525"

  # Override URL
  CONTAINER_API_URL=https://create-a-container-dev.opensource.mieweb.org/containers $0 test-container 10.15.7.7 rgingras debian 123 AA:BB:CC:DD:EE:FF N 80
EOF
    exit 1
}

# Check required parameters
if [[ $# -lt 9 ]]; then
    echo "❌ Error: Missing required parameters" >&2
    echo "" >&2
    usage
fi

# Assign positional parameters
hostname="$1"
ipv4Address="$2"
username="$3"
osRelease="$4"
containerId="$5"
macAddress="$6"
aiContainer="$7"
httpPort="$8"

# Optional parameters
additionalProtocols="${9:-}"

# Default URL
url="${CONTAINER_API_URL:-http://localhost:3000/containers}"

echo "📡 Registering container via API..."
echo "   URL: $url"
echo "   Hostname: $hostname"
echo "   IPv4: $ipv4Address"
echo ""

# Build curl command
curl_cmd=(
    curl -X POST "$url"
    -H "Content-Type: application/x-www-form-urlencoded"
    --data-urlencode "hostname=$hostname"
    --data-urlencode "ipv4Address=$ipv4Address"
    --data-urlencode "username=$username"
    --data-urlencode "osRelease=$osRelease"
    --data-urlencode "containerId=$containerId"
    --data-urlencode "macAddress=$macAddress"
    --data-urlencode "aiContainer=$aiContainer"
    --data-urlencode "httpPort=$httpPort"
)

# Add optional parameters if provided
if [[ -n "$additionalProtocols" ]]; then
    curl_cmd+=(--data-urlencode "additionalProtocols=$additionalProtocols")
fi

# Execute curl
"${curl_cmd[@]}"
echo ""
echo "✅ Request sent"
