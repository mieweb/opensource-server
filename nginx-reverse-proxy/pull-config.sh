#!/usr/bin/env bash

set -euo pipefail

CONF_FILE=/etc/nginx/conf.d/reverse-proxy.conf
CONF_URL=https://create-a-container.opensource.mieweb.org/nginx.conf

mv "${CONF_FILE}" "${CONF_FILE}.bak"
curl -fsSL -o "${CONF_FILE}" "${CONF_URL}"

if ! nginx -t; then
  mv "${CONF_FILE}.bak" "${CONF_FILE}"
  exit 1
fi

rm -f "${CONF_FILE}.bak"
nginx -s reload