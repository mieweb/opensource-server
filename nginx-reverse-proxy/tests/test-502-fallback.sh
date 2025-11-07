#!/usr/bin/env bash
#
# Additional test for 502 fallback behavior
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/nginx-pull-config-502-test-$$"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Setup test environment
setup() {
  echo -e "${YELLOW}Setting up test environment for 502 fallback test...${NC}"
  mkdir -p "${TEST_DIR}/etc/nginx/conf.d"
  mkdir -p "${TEST_DIR}/bin"
  
  # Create a mock nginx command
  cat > "${TEST_DIR}/bin/nginx" <<'EOF'
#!/bin/bash
case "$1" in
  -t)
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
  export PATH="${TEST_DIR}/bin:${PATH}"
}

# Cleanup
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
  rm -rf "${TEST_DIR}"
}

# Test 502 fallback
test_502_fallback() {
  echo -e "\n${YELLOW}Test: 502 error with fallback to internal URL${NC}"
  
  # Create modified script
  local test_script="${TEST_DIR}/pull-config-502-test.sh"
  sed "s|/etc/nginx/conf.d|${TEST_DIR}/etc/nginx/conf.d|g" "${SCRIPT_DIR}/pull-config.sh" > "${test_script}"
  chmod +x "${test_script}"
  
  # Create curl mock that returns 502 for primary URL, 200 for fallback
  cat > "${TEST_DIR}/bin/curl" <<'EOF'
#!/bin/bash
url=""
output_file=""
headers_file=""

# Parse arguments
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
    -H|-w)
      shift 2
      ;;
    -sSL)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

# Check which URL is being requested
if [[ "${url}" == *"create-a-container.opensource.mieweb.org"* ]]; then
  # Primary URL - return 502
  if [[ -n "${headers_file}" ]]; then
    cat > "${headers_file}" <<HEADERS
HTTP/1.1 502 Bad Gateway
Content-Type: text/html
Content-Length: 150

HEADERS
  fi
  if [[ -n "${output_file}" ]]; then
    echo "<html><body>502 Bad Gateway</body></html>" > "${output_file}"
  fi
  echo "502"
elif [[ "${url}" == *"create-a-container.cluster.mieweb.org"* ]]; then
  # Fallback URL - return 200
  if [[ -n "${headers_file}" ]]; then
    cat > "${headers_file}" <<HEADERS
HTTP/1.1 200 OK
Content-Type: text/plain
ETag: "fallback-etag-123"
Content-Length: 30

HEADERS
  fi
  if [[ -n "${output_file}" ]]; then
    echo "# Config from fallback URL" > "${output_file}"
  fi
  echo "200"
else
  echo "000"
fi
EOF
  chmod +x "${TEST_DIR}/bin/curl"
  export PATH="${TEST_DIR}/bin:${PATH}"
  
  # Run the script
  if "${test_script}" 2>&1 | tee "${TEST_DIR}/output.log"; then
    # Check that config was created from fallback
    if [[ -f "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf" ]]; then
      if grep -q "fallback URL" "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf"; then
        echo -e "${GREEN}✓ Test passed: Fallback URL used successfully${NC}"
        
        # Check that fallback message was logged
        if grep -q "Primary URL failed" "${TEST_DIR}/output.log"; then
          echo -e "${GREEN}✓ Test passed: Fallback message logged${NC}"
          return 0
        else
          echo -e "${RED}✗ Test failed: No fallback message in output${NC}"
          return 1
        fi
      else
        echo -e "${RED}✗ Test failed: Config not from fallback URL${NC}"
        cat "${TEST_DIR}/etc/nginx/conf.d/reverse-proxy.conf"
        return 1
      fi
    else
      echo -e "${RED}✗ Test failed: Config file not created${NC}"
      return 1
    fi
  else
    echo -e "${RED}✗ Test failed: Script exited with error${NC}"
    cat "${TEST_DIR}/output.log"
    return 1
  fi
}

# Main
main() {
  echo -e "${YELLOW}=== Testing 502 Fallback Behavior ===${NC}"
  
  setup
  
  if test_502_fallback; then
    cleanup
    echo -e "\n${GREEN}502 fallback test passed!${NC}"
    exit 0
  else
    cleanup
    echo -e "\n${RED}502 fallback test failed${NC}"
    exit 1
  fi
}

main "$@"
