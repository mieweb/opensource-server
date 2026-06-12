#!/bin/bash

set -euo pipefail

# Sync users from the create-a-container API into the authentik API.
#
# Reads every user from `GET /api/v1/users` (admin-only) and creates any that
# are missing in authentik via `POST /api/v3/core/users/`. Users that already
# exist in authentik (matched by username) are skipped — this script never
# updates or deletes existing authentik users, so it is safe to re-run.
#
# Passwords are NOT copied: the create-a-container API never exposes password
# hashes, and authentik users authenticate via the enrollment/recovery flows or
# an external source. Created users are therefore left without a usable password.

usage() {
    cat <<EOF
Usage: $0 [--dry-run]

Sync users from the create-a-container API into authentik (create-only).

Options:
  --dry-run   Show what would be created without calling the authentik API.
  -h, --help  Show this help.

Environment Variables (required):
  CAC_API_URL          Base URL of the create-a-container API.
                       (e.g. https://create-a-container.opensource.mieweb.org)
  CAC_API_KEY          create-a-container API key (Bearer) for an admin user.
  AUTHENTIK_URL        Base URL of the authentik instance.
                       (e.g. https://authentik.opensource.mieweb.org)
  AUTHENTIK_TOKEN      authentik API token (Bearer) with permission to
                       list and create users.

Environment Variables (optional):
  AUTHENTIK_USER_PATH  Directory path for new authentik users.
                       (default: users)
  AUTHENTIK_USER_TYPE  authentik user type: internal | external | service_account.
                       (default: internal)

Examples:
  CAC_API_URL=https://create-a-container.opensource.mieweb.org \\
  CAC_API_KEY=cac_xxx \\
  AUTHENTIK_URL=https://authentik.opensource.mieweb.org \\
  AUTHENTIK_TOKEN=ak_xxx \\
    $0

  # Preview only:
  ... $0 --dry-run
EOF
    exit "${1:-1}"
}

# --- Parse arguments ---------------------------------------------------------
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help) usage 0 ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "" >&2
            usage
            ;;
    esac
done

# --- Dependency & config checks ----------------------------------------------
for cmd in curl jq; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Error: required command '$cmd' is not installed." >&2
        exit 1
    fi
done

missing=0
for var in CAC_API_URL CAC_API_KEY AUTHENTIK_URL AUTHENTIK_TOKEN; do
    if [[ -z "${!var:-}" ]]; then
        echo "Error: $var is required." >&2
        missing=1
    fi
done
[[ "$missing" -eq 1 ]] && { echo "" >&2; usage; }

AUTHENTIK_USER_PATH="${AUTHENTIK_USER_PATH:-users}"
AUTHENTIK_USER_TYPE="${AUTHENTIK_USER_TYPE:-internal}"

# Strip any trailing slash so we can build URLs consistently.
CAC_API_URL="${CAC_API_URL%/}"
AUTHENTIK_URL="${AUTHENTIK_URL%/}"

# --- HTTP helpers ------------------------------------------------------------
# Each helper prints the response body to stdout and the HTTP status to fd 3
# via a temp file, so callers can branch on the status code.

cac_get() {
    # $1 = path (e.g. /api/v1/users)
    curl -sS \
        -H "Authorization: Bearer $CAC_API_KEY" \
        -H "Accept: application/json" \
        "$CAC_API_URL$1"
}

authentik_get() {
    # $1 = path with query string
    curl -sS \
        -H "Authorization: Bearer $AUTHENTIK_TOKEN" \
        -H "Accept: application/json" \
        "$AUTHENTIK_URL$1"
}

authentik_post() {
    # $1 = path, $2 = json body; writes HTTP status as the last line.
    curl -sS -w '\n%{http_code}' \
        -X POST \
        -H "Authorization: Bearer $AUTHENTIK_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "$2" \
        "$AUTHENTIK_URL$1"
}

# --- Fetch users from create-a-container -------------------------------------
echo "Fetching users from create-a-container API..."
echo "   $CAC_API_URL/api/v1/users"

users_response="$(cac_get /api/v1/users)"

# The API wraps success as { data: [...] } and errors as { error: {...} }.
if echo "$users_response" | jq -e '.error' >/dev/null 2>&1; then
    echo "Error from create-a-container API:" >&2
    echo "$users_response" | jq -r '.error | "  [\(.code)] \(.message)"' >&2
    exit 1
fi

if ! echo "$users_response" | jq -e '.data | type == "array"' >/dev/null 2>&1; then
    echo "Error: unexpected response from create-a-container API:" >&2
    echo "$users_response" >&2
    exit 1
fi

user_count="$(echo "$users_response" | jq '.data | length')"
echo "   Found $user_count user(s)."
echo ""

# --- Sync loop ---------------------------------------------------------------
created=0
skipped=0
failed=0

# Iterate users as compact JSON lines so each record survives the pipe intact.
while IFS= read -r user; do
    uid="$(echo "$user" | jq -r '.uid')"
    cn="$(echo "$user" | jq -r '.cn // .uid')"
    mail="$(echo "$user" | jq -r '.mail // ""')"
    status="$(echo "$user" | jq -r '.status // ""')"

    if [[ -z "$uid" || "$uid" == "null" ]]; then
        echo "! Skipping a user with no uid: $user" >&2
        failed=$((failed + 1))
        continue
    fi

    # Check whether the user already exists in authentik (match by username).
    # The list endpoint supports an exact ?username= filter.
    existing="$(authentik_get "/api/v3/core/users/?username=$(jq -rn --arg u "$uid" '$u|@uri')")"

    if ! echo "$existing" | jq -e 'has("results")' >/dev/null 2>&1; then
        echo "! Failed to query authentik for '$uid':" >&2
        echo "$existing" | jq -r '.detail // .' >&2 || echo "$existing" >&2
        failed=$((failed + 1))
        continue
    fi

    match_count="$(echo "$existing" | jq '[.results[] | select(.username == $uid)] | length' --arg uid "$uid")"
    if [[ "$match_count" -gt 0 ]]; then
        echo "= Skip (exists): $uid"
        skipped=$((skipped + 1))
        continue
    fi

    # Build the authentik create payload.
    #   username  <- uid
    #   name      <- cn (full name)
    #   email     <- mail
    #   is_active <- status == 'active'
    #   attributes preserves the POSIX/source fields used by the LDAP provider.
    is_active="false"
    [[ "$status" == "active" ]] && is_active="true"

    payload="$(jq -n \
        --arg username "$uid" \
        --arg name "$cn" \
        --arg email "$mail" \
        --arg path "$AUTHENTIK_USER_PATH" \
        --arg type "$AUTHENTIK_USER_TYPE" \
        --argjson is_active "$is_active" \
        --argjson source "$user" \
        '{
            username: $username,
            name: $name,
            email: $email,
            is_active: $is_active,
            path: $path,
            type: $type,
            attributes: {
                uidNumber: $source.uidNumber,
                givenName: $source.givenName,
                sn: $source.sn,
                status: $source.status,
                managedBy: "create-a-container-sync"
            }
        }')"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "~ Would create: $uid ($cn <$mail>, active=$is_active)"
        created=$((created + 1))
        continue
    fi

    response="$(authentik_post /api/v3/core/users/ "$payload")"
    http_code="$(echo "$response" | tail -n1)"
    body="$(echo "$response" | sed '$d')"

    if [[ "$http_code" == "201" ]]; then
        new_pk="$(echo "$body" | jq -r '.pk // "?"')"
        echo "+ Created: $uid (authentik pk=$new_pk)"
        created=$((created + 1))
    else
        echo "! Failed to create '$uid' (HTTP $http_code):" >&2
        echo "$body" | jq -r 'if type=="object" then (to_entries | map("    \(.key): \(.value)") | join("\n")) else . end' >&2 \
            || echo "    $body" >&2
        failed=$((failed + 1))
    fi
done < <(echo "$users_response" | jq -c '.data[]')

# --- Summary -----------------------------------------------------------------
echo ""
echo "================================================="
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry run complete (no changes made)."
    echo "  Would create: $created"
else
    echo "Sync complete."
    echo "  Created: $created"
fi
echo "  Skipped (already exist): $skipped"
echo "  Failed:  $failed"
echo "================================================="

[[ "$failed" -gt 0 ]] && exit 1
exit 0
