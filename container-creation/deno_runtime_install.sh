#!/bin/bash
# Script to install a specific deno.js runtime version
# https://docs.deno.com/runtime/getting_started/installation/
# ----------------------------------------------------------

pct enter "$CONTAINER_ID" -- <<EOF
curl -fsSL https://deno.land/install.sh | sudo -E bash -s -- "$@"
EOF
