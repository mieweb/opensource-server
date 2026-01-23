#!/bin/bash

# Test API key authentication for all non-admin routes
# Usage: ./test-api-key.sh <api-key>

API_KEY="$1"
BASE_URL="http://localhost:3000"

if [ -z "$API_KEY" ]; then
  echo "Usage: $0 <api-key>"
  exit 1
fi

echo "Testing non-admin routes with API key authentication"
echo "================================================="
echo ""

# Sites
echo "GET /sites"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/sites" | jq -r '.error // "✓ Success"'

# API Keys
echo "GET /apikeys"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/apikeys" | jq -r '.error // "✓ Success"'

# Containers (requires siteId)
echo "GET /sites/1/containers"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/sites/1/containers" | jq -r '.error // "✓ Success"'

echo "GET /sites/1/containers/new"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/sites/1/containers/new" | jq -r '.error // "✓ Success"'

# Jobs
echo "GET /jobs/:id (using test id 123)"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/jobs/123" | jq -r '.error // "✓ Success"'

echo "GET /jobs/:id/status (using test id 123)"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/jobs/123/status" | jq -r '.error // "✓ Success"'

# External Domains  
echo "GET /sites/1/external-domains"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/sites/1/external-domains" | jq -r '.error // "✓ Success"'

echo ""
echo "================================================="
echo "Test complete"
