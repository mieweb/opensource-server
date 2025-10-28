#!/usr/bin/env bash

set -euo pipefail

CONF_FILE=/etc/nginx/conf.d/reverse-proxy.conf
ETAG_FILE=/etc/nginx/conf.d/reverse-proxy.etag
CONF_URL=https://create-a-container.opensource.mieweb.org/nginx.conf
FALLBACK_URL=http://create-a-container.cluster.mieweb.org:3000/nginx.conf

# Function to download config and extract ETag
download_config() {
  local url="$1"
  local temp_file="${CONF_FILE}.tmp"
  local headers_file="${CONF_FILE}.headers"
  
  # Read existing ETag if it exists
  local etag_header=""
  if [[ -f "${ETAG_FILE}" ]]; then
    local etag
    etag=$(cat "${ETAG_FILE}")
    etag_header="If-None-Match: ${etag}"
  fi
  
  # Download with headers, capture HTTP status code
  # Note: We don't use -f flag to allow handling of all HTTP status codes
  local http_code
  if [[ -n "${etag_header}" ]]; then
    http_code=$(curl -w "%{http_code}" -D "${headers_file}" -H "${etag_header}" -o "${temp_file}" -sSL "${url}" 2>/dev/null || echo "000")
  else
    http_code=$(curl -w "%{http_code}" -D "${headers_file}" -o "${temp_file}" -sSL "${url}" 2>/dev/null || echo "000")
  fi
  
  # Return the http_code
  echo "${http_code}"
}

# Try primary URL
HTTP_CODE=$(download_config "${CONF_URL}")

# Handle 502 error with fallback
if [[ ${HTTP_CODE} -eq 502 ]] || [[ ${HTTP_CODE} -eq 000 ]]; then
  echo "Primary URL failed (HTTP ${HTTP_CODE}), trying fallback URL..." >&2
  rm -f "${CONF_FILE}.tmp" "${CONF_FILE}.headers"
  HTTP_CODE=$(download_config "${FALLBACK_URL}")
fi

# Check if we got a 304 Not Modified
if [[ ${HTTP_CODE} -eq 304 ]]; then
  # No changes, clean up temp files and exit
  rm -f "${CONF_FILE}.tmp" "${CONF_FILE}.headers"
  exit 0
fi

# Check if we got a successful response
if [[ ${HTTP_CODE} -ne 200 ]]; then
  rm -f "${CONF_FILE}.tmp" "${CONF_FILE}.headers"
  echo "Failed to download configuration (HTTP ${HTTP_CODE})" >&2
  exit 1
fi

# Extract new ETag from headers
NEW_ETAG=""
if [[ -f "${CONF_FILE}.headers" ]]; then
  NEW_ETAG=$(grep -i '^etag:' "${CONF_FILE}.headers" | sed 's/^etag: *//i' | tr -d '\r\n' || echo "")
fi

# Backup existing config if it exists
if [[ -f "${CONF_FILE}" ]]; then
  mv "${CONF_FILE}" "${CONF_FILE}.bak"
fi

# Move new config into place
mv "${CONF_FILE}.tmp" "${CONF_FILE}"

# Test the new configuration
if ! nginx -t; then
  # Restore backup if it exists
  if [[ -f "${CONF_FILE}.bak" ]]; then
    mv "${CONF_FILE}.bak" "${CONF_FILE}"
  else
    # No backup, just remove the bad config
    rm -f "${CONF_FILE}"
  fi
  rm -f "${CONF_FILE}.headers"
  exit 1
fi

# Configuration is valid, clean up backup and save new ETag
rm -f "${CONF_FILE}.bak" "${CONF_FILE}.headers"
if [[ -n "${NEW_ETAG}" ]]; then
  echo "${NEW_ETAG}" > "${ETAG_FILE}"
fi
nginx -s reload