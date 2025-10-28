#!/usr/bin/env bash

set -euo pipefail

CONF_FILE=/etc/nginx/conf.d/reverse-proxy.conf
ETAG_FILE="${CONF_FILE}.etag"
TEMP_FILE="${CONF_FILE}.tmp"
HEADERS_FILE="${CONF_FILE}.headers"
BACKUP_FILE="${CONF_FILE}.bak"
CONF_URL=https://create-a-container.opensource.mieweb.org/nginx.conf
FALLBACK_URL=http://create-a-container.cluster.mieweb.org:3000/nginx.conf

# Cleanup function
cleanup() {
  rm -f "${TEMP_FILE}" "${HEADERS_FILE}" "${BACKUP_FILE}"
}

# Set trap to always cleanup on exit
trap cleanup EXIT

# Function to download config and extract ETag
download_config() {
  local url="$1"
  
  # Build curl command as array
  local curl_cmd=(
    curl
    -w "%{http_code}"
    -D "${HEADERS_FILE}"
    -o "${TEMP_FILE}"
    -sSL
  )
  
  # Add ETag header if it exists
  if [[ -f "${ETAG_FILE}" ]]; then
    local etag
    etag=$(cat "${ETAG_FILE}")
    curl_cmd+=(-H "If-None-Match: ${etag}")
  fi
  
  # Add URL
  curl_cmd+=("${url}")
  
  # Execute curl and capture HTTP status code
  local http_code
  http_code=$("${curl_cmd[@]}" 2>/dev/null || echo "000")
  
  # Return the http_code
  echo "${http_code}"
}

# Try primary URL
HTTP_CODE=$(download_config "${CONF_URL}")

# Handle 502 error with fallback
if [[ ${HTTP_CODE} -eq 502 ]] || [[ ${HTTP_CODE} -eq 000 ]]; then
  echo "Primary URL failed (HTTP ${HTTP_CODE}), trying fallback URL..." >&2
  HTTP_CODE=$(download_config "${FALLBACK_URL}")
fi

# Check if we got a 304 Not Modified
if [[ ${HTTP_CODE} -eq 304 ]]; then
  # No changes, exit (cleanup handled by trap)
  exit 0
fi

# Check if we got a successful response
if [[ ${HTTP_CODE} -ne 200 ]]; then
  echo "Failed to download configuration (HTTP ${HTTP_CODE})" >&2
  exit 1
fi

# Extract new ETag from headers
NEW_ETAG=""
if [[ -f "${HEADERS_FILE}" ]]; then
  NEW_ETAG=$(grep -i '^etag:' "${HEADERS_FILE}" | sed 's/^etag: *//i' | tr -d '\r\n' || echo "")
fi

# Backup existing config if it exists
if [[ -f "${CONF_FILE}" ]]; then
  mv "${CONF_FILE}" "${BACKUP_FILE}"
fi

# Move new config into place
mv "${TEMP_FILE}" "${CONF_FILE}"

# Test the new configuration
if ! nginx -t; then
  # Restore backup if it exists
  if [[ -f "${BACKUP_FILE}" ]]; then
    mv "${BACKUP_FILE}" "${CONF_FILE}"
  else
    # No backup, just remove the bad config
    rm -f "${CONF_FILE}"
  fi
  exit 1
fi

# Configuration is valid, save new ETag (cleanup handled by trap)
if [[ -n "${NEW_ETAG}" ]]; then
  echo "${NEW_ETAG}" > "${ETAG_FILE}"
fi
nginx -s reload