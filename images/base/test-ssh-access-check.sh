#!/usr/bin/env bash
# Smoke test for images/base/ssh-access-check.sh with a stubbed curl.
# Run: bash images/base/test-ssh-access-check.sh
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/ssh-access-check.sh"
STUBS=$(mktemp -d)
export SSH_ACCESS_DIR=$(mktemp -d)
export SSH_ACCESS_CACHE_DIR=$(mktemp -d)
export SSH_ACCESS_CACHE_TTL=60

# curl stub: returns the status code in $CURL_CODE and records the URL + stdin config.
cat >"$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
cat >/tmp/ssh-access-curl-config.log
for a in "$@"; do case "$a" in http*) echo "$a" >/tmp/ssh-access-curl-url.log;; esac; done
[ "${CURL_CODE:-000}" = 000 ] && exit 7
printf '%s' "$CURL_CODE"
EOF
cat >"$STUBS/logger" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>/tmp/ssh-access-logger.log
EOF
chmod +x "$STUBS/curl" "$STUBS/logger"
export PATH="$STUBS:$PATH"

fail=0
check() { # desc expected actual
    if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expected '$2', got '$3')"; fail=1; fi
}
run() { # code user -> exit status
    CURL_CODE=$1 bash "$SCRIPT" "$2" >/dev/null 2>&1; echo $?
}
rm -f /tmp/ssh-access-*.log

# --- Unenrolled: no token files -> allow, curl never called ---
check "unenrolled allows" 0 "$(run 204 alice)"
[ -f /tmp/ssh-access-curl-url.log ] && { echo "FAIL: curl called while unenrolled"; fail=1; } || echo "PASS: no manager call while unenrolled"

# --- Enrolled ---
printf 'https://manager.example\n' >"$SSH_ACCESS_DIR/url"
printf '42\n' >"$SSH_ACCESS_DIR/id"
printf 'sekrit\n' >"$SSH_ACCESS_DIR/token"

check "204 allows" 0 "$(run 204 alice)"
check "url built from id + user" "https://manager.example/api/v1/containers/42/ssh-access/alice" "$(cat /tmp/ssh-access-curl-url.log)"
grep -q 'Authorization: Bearer sekrit' /tmp/ssh-access-curl-config.log && echo "PASS: token sent via stdin config" || { echo "FAIL: token header"; fail=1; }
[ -f "$SSH_ACCESS_CACHE_DIR/alice" ] && echo "PASS: allow cached" || { echo "FAIL: cache not written"; fail=1; }

check "403 denies" 1 "$(run 403 bob)"
check "400 denies" 1 "$(run 400 bob)"
check "403 clears cache" 1 "$(run 403 alice)"
[ -f "$SSH_ACCESS_CACHE_DIR/alice" ] && { echo "FAIL: cache kept after deny"; fail=1; } || echo "PASS: cache cleared on deny"

# --- Manager unreachable: cached allow within TTL, otherwise deny ---
run 204 alice >/dev/null
check "unreachable + fresh cache allows" 0 "$(run 000 alice)"
check "unreachable + no cache denies" 1 "$(run 000 carol)"
check "401 (token rotated) falls back to cache" 0 "$(run 401 alice)"
touch -t 202001010000 "$SSH_ACCESS_CACHE_DIR/alice"
check "unreachable + stale cache denies" 1 "$(run 000 alice)"

# --- Username validation happens before any call ---
rm -f /tmp/ssh-access-curl-url.log
check "invalid username denied" 1 "$(run 204 'Bad;Name')"
check "path traversal denied" 1 "$(run 204 '../x')"
[ -f /tmp/ssh-access-curl-url.log ] && { echo "FAIL: curl called for invalid user"; fail=1; } || echo "PASS: no call for invalid user"

# --- PAM path: user comes from PAM_USER ---
check "PAM_USER honoured" 0 "$(CURL_CODE=204 PAM_USER=alice bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
check "PAM_USER empty denied" 1 "$(CURL_CODE=204 PAM_USER= bash "$SCRIPT" >/dev/null 2>&1; echo $?)"

rm -rf "$STUBS" "$SSH_ACCESS_DIR" "$SSH_ACCESS_CACHE_DIR" /tmp/ssh-access-*.log
exit $fail
