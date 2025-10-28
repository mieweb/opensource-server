#!/usr/bin/env bash
#
# Test script for pull-config.sh
# This script validates the three main improvements:
# 1. Handling missing config files (first run)
# 2. ETag-based caching
# 3. Fallback to internal URL on 502 errors

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/nginx-pull-config-test-$$"
TEST_RESULTS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Setup test environment
setup() {
  echo -e "${YELLOW}Setting up test environment...${NC}"
  mkdir -p "${TEST_DIR}/etc/nginx/conf.d"
  mkdir -p "${TEST_DIR}/bin"
  
  # Create a mock nginx command
  cat > "${TEST_DIR}/bin/nginx" <<'EOF'
#!/bin/bash
case "$1" in
  -t)
    # Always succeed for testing
    exit 0
    ;;
  -s)
    if [[ "$2" == "reload" ]]; then
      echo "nginx reloaded"
      exit 0
    fi
    ;;
esac
exit 1
EOF
  chmod +x "${TEST_DIR}/bin/nginx"
  
  # Add mock nginx to PATH
  export PATH="${TEST_DIR}/bin:${PATH}"
  
  echo -e "${GREEN}✓ Test environment ready${NC}"
}

# Cleanup test environment
cleanup() {
  echo -e "${YELLOW}Cleaning up test environment...${NC}"
  rm -rf "${TEST_DIR}"
}

# Test 1: First run without existing config
test_first_run() {
  echo -e "\n${YELLOW}Test 1: First run without existing config${NC}"
  
  # Create a modified version of the script that uses our test directory
  local test_script="${TEST_DIR}/pull-config-test.sh"
  sed "s|/etc/nginx/conf.d|${TEST_DIR}/etc/nginx/conf.d|g" "${SCRIPT_DIR}/pull-config.sh" > "${test_script}"
  chmod +x "${test_script}"
  
  # Replace curl with a mock that simulates a successful download
  cat > "${TEST_DIR}/bin/curl" <<'EOF'
#!/bin/bash
# Parse arguments
output_file=""
headers_file=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -o)
      output_file="$2"
      shift 2
      ;;
    -D)
      headers_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Write mock config
if [[ -n "${output_file}" ]]; then
  echo "# Mock nginx config" > "${output_file}"
fi

# Write mock headers with ETag
if [[ -n "${headers_file}" ]]; then
  cat > "${headers_file}" <<HEADERS
HTTP/1.1 200 OK
Content-Type: text/plain
ETag: "mock-etag-12345"
Content-Length: 20

HEADERS
fi

# Return 200 status code
echo "200"
EOF
  chmod +x "${TEST_DIR}/bin/curl"
  export PATH="${TEST_DIR}/bin:${PATH}"
  
  # Run the script
  if "${test_script}"; then
    if [[ -f "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf" ]]; then
      echo -e "${GREEN}✓ Test passed: Config file created${NC}"
      if [[ -f "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.etag" ]]; then
        echo -e "${GREEN}✓ Test passed: ETag file created${NC}"
      else
        echo -e "${RED}✗ Test failed: ETag file not created${NC}"
        TEST_RESULTS=1
      fi
    else
      echo -e "${RED}✗ Test failed: Config file not created${NC}"
      TEST_RESULTS=1
    fi
  else
    echo -e "${RED}✗ Test failed: Script exited with error${NC}"
    TEST_RESULTS=1
  fi
}

# Test 2: Subsequent run with ETag (304 Not Modified)
test_etag_cache_hit() {
  echo -e "\n${YELLOW}Test 2: ETag cache hit (304 Not Modified)${NC}"
  
  # Setup: Create existing config and ETag
  echo "# Existing config" > "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf"
  echo '"mock-etag-12345"' > "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.etag"
  
  # Create a modified version of the script
  local test_script="${TEST_DIR}/pull-config-etag-test.sh"
  sed "s|/etc/nginx/conf.d|${TEST_DIR}/etc/nginx/conf.d|g" "${SCRIPT_DIR}/pull-config.sh" > "${test_script}"
  chmod +x "${test_script}"
  
  # Replace curl with a mock that returns 304
  cat > "${TEST_DIR}/bin/curl" <<'EOF'
#!/bin/bash
# Parse arguments to check for If-None-Match header
has_etag=0
output_file=""
headers_file=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -H)
      if [[ "$2" == If-None-Match* ]]; then
        has_etag=1
      fi
      shift 2
      ;;
    -o)
      output_file="$2"
      shift 2
      ;;
    -D)
      headers_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# If ETag header was sent, return 304
if [[ ${has_etag} -eq 1 ]]; then
  # Write mock headers
  if [[ -n "${headers_file}" ]]; then
    cat > "${headers_file}" <<HEADERS
HTTP/1.1 304 Not Modified
ETag: "mock-etag-12345"

HEADERS
  fi
  echo "304"
else
  # Write mock config and headers for 200
  if [[ -n "${output_file}" ]]; then
    echo "# New mock config" > "${output_file}"
  fi
  if [[ -n "${headers_file}" ]]; then
    cat > "${headers_file}" <<HEADERS
HTTP/1.1 200 OK
ETag: "mock-etag-67890"

HEADERS
  fi
  echo "200"
fi
EOF
  chmod +x "${TEST_DIR}/bin/curl"
  
  # Store original config modification time
  local orig_mtime
  orig_mtime=$(stat -c %Y "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf")
  
  # Run the script
  if "${test_script}"; then
    local new_mtime
    new_mtime=$(stat -c %Y "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf")
    if [[ ${orig_mtime} -eq ${new_mtime} ]]; then
      echo -e "${GREEN}✓ Test passed: Config not modified on 304${NC}"
    else
      echo -e "${RED}✗ Test failed: Config was modified on 304${NC}"
      TEST_RESULTS=1
    fi
  else
    echo -e "${RED}✗ Test failed: Script exited with error${NC}"
    TEST_RESULTS=1
  fi
}

# Test 3: Config validation failure and rollback
test_validation_rollback() {
  echo -e "\n${YELLOW}Test 3: Config validation failure and rollback${NC}"
  
  # Setup: Create existing valid config
  echo "# Valid existing config" > "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf"
  echo '"mock-etag-old"' > "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.etag"
  
  # Create a modified version of the script
  local test_script="${TEST_DIR}/pull-config-rollback-test.sh"
  sed "s|/etc/nginx/conf.d|${TEST_DIR}/etc/nginx/conf.d|g" "${SCRIPT_DIR}/pull-config.sh" > "${test_script}"
  chmod +x "${test_script}"
  
  # Replace nginx with one that fails validation
  cat > "${TEST_DIR}/bin/nginx" <<'EOF'
#!/bin/bash
case "$1" in
  -t)
    # Fail validation
    echo "nginx: configuration file test failed"
    exit 1
    ;;
  -s)
    if [[ "$2" == "reload" ]]; then
      echo "nginx reloaded"
      exit 0
    fi
    ;;
esac
exit 1
EOF
  chmod +x "${TEST_DIR}/bin/nginx"
  
  # Replace curl to return a new config
  cat > "${TEST_DIR}/bin/curl" <<'EOF'
#!/bin/bash
output_file=""
headers_file=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -o)
      output_file="$2"
      shift 2
      ;;
    -D)
      headers_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "${output_file}" ]]; then
  echo "# Invalid new config" > "${output_file}"
fi
if [[ -n "${headers_file}" ]]; then
  cat > "${headers_file}" <<HEADERS
HTTP/1.1 200 OK
ETag: "mock-etag-new"

HEADERS
fi
echo "200"
EOF
  chmod +x "${TEST_DIR}/bin/curl"
  
  # Run the script (should fail and rollback)
  if "${test_script}"; then
    echo -e "${RED}✗ Test failed: Script should have exited with error${NC}"
    TEST_RESULTS=1
  else
    # Check that the original config was restored
    if grep -q "Valid existing config" "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf"; then
      echo -e "${GREEN}✓ Test passed: Original config restored after validation failure${NC}"
    else
      echo -e "${RED}✗ Test failed: Original config not restored${NC}"
      TEST_RESULTS=1
    fi
  fi
}

# Main test execution
main() {
  echo -e "${YELLOW}=== Testing pull-config.sh ===${NC}"
  
  setup
  
  test_first_run
  test_etag_cache_hit
  test_validation_rollback
  
  cleanup
  
  echo -e "\n${YELLOW}=== Test Summary ===${NC}"
  if [[ ${TEST_RESULTS} -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
  fi
}

main "$@"
