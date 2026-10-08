#!/bin/bash
# setup-mail-db-roles.sh — create the read-only DB users the mail stack uses.
#
#   mail_dovecot  SELECT on mail_accounts_v                     (passdb/userdb)
#   mail_postfix  SELECT on mail_senders_v, mail_suppressions_v (sender/suppression maps)
#
# The views are created by migration 20261008000006-create-mail-views.js; this
# script only creates the users and grants. Passwords are generated and
# appended to the env file as MAIL_DOVECOT_DB_PASSWORD / MAIL_POSTFIX_DB_PASSWORD
# so the agent can template them into the Dovecot/Postfix SQL config. When the
# DB is local to the mail host, socket auth (Postgres peer / MariaDB
# unix_socket) also works and the passwords are unused.
#
# Runs idempotently from container-creator-init.service and the package
# postinst. Supports:
#   --print-sql   print the SQL for a DBA instead of executing it
#   --rotate      regenerate passwords even if already present
#
# Reads DATABASE_DIALECT and connection settings from ENV_FILE
# (default /etc/default/container-creator).
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/default/container-creator}"
PRINT_SQL=0
ROTATE=0
for arg in "$@"; do
  case "$arg" in
    --print-sql) PRINT_SQL=1 ;;
    --rotate) ROTATE=1 ;;
    *) echo "usage: $0 [--print-sql] [--rotate]" >&2; exit 2 ;;
  esac
done

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

DIALECT="${DATABASE_DIALECT:-sqlite}"
case "$DIALECT" in
  postgres|mysql|mariadb) ;;
  *)
    echo "setup-mail-db-roles: DATABASE_DIALECT=$DIALECT cannot host mail (needs postgres or mysql/mariadb); nothing to do."
    exit 0
    ;;
esac

# Read an existing password out of the env file, if any.
get_env_var() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-; }

# Insert-or-replace VAR=value in the env file.
set_env_var() {
  local var="$1" value="$2"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -qE "^${var}=" "$ENV_FILE"; then
    sed -i "s|^${var}=.*|${var}=${value}|" "$ENV_FILE"
  else
    echo "${var}=${value}" >> "$ENV_FILE"
  fi
}

gen_password() { openssl rand -base64 32 | tr -d '/+=' | head -c 32; }

DOVECOT_PW="$(get_env_var MAIL_DOVECOT_DB_PASSWORD || true)"
POSTFIX_PW="$(get_env_var MAIL_POSTFIX_DB_PASSWORD || true)"
if [ "$ROTATE" = 1 ] || [ -z "$DOVECOT_PW" ]; then DOVECOT_PW="$(gen_password)"; fi
if [ "$ROTATE" = 1 ] || [ -z "$POSTFIX_PW" ]; then POSTFIX_PW="$(gen_password)"; fi

sql_postgres() {
  cat <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mail_dovecot') THEN
    CREATE ROLE mail_dovecot LOGIN PASSWORD '${DOVECOT_PW}';
  ELSE
    ALTER ROLE mail_dovecot WITH LOGIN PASSWORD '${DOVECOT_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mail_postfix') THEN
    CREATE ROLE mail_postfix LOGIN PASSWORD '${POSTFIX_PW}';
  ELSE
    ALTER ROLE mail_postfix WITH LOGIN PASSWORD '${POSTFIX_PW}';
  END IF;
  -- Views appear with the first migration run; that migration also grants,
  -- so skipping here just means the other side finishes the handshake.
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'mail_accounts_v') THEN
    GRANT SELECT ON mail_accounts_v TO mail_dovecot;
    GRANT SELECT ON mail_senders_v, mail_suppressions_v TO mail_postfix;
  END IF;
END \$\$;
SQL
}

sql_mysql() {
  local db="${MYSQL_DATABASE:-container_creator}"
  cat <<SQL
CREATE USER IF NOT EXISTS 'mail_dovecot'@'%' IDENTIFIED BY '${DOVECOT_PW}';
ALTER USER 'mail_dovecot'@'%' IDENTIFIED BY '${DOVECOT_PW}';
CREATE USER IF NOT EXISTS 'mail_postfix'@'%' IDENTIFIED BY '${POSTFIX_PW}';
ALTER USER 'mail_postfix'@'%' IDENTIFIED BY '${POSTFIX_PW}';
GRANT SELECT ON \`${db}\`.mail_accounts_v TO 'mail_dovecot'@'%';
GRANT SELECT ON \`${db}\`.mail_senders_v TO 'mail_postfix'@'%';
GRANT SELECT ON \`${db}\`.mail_suppressions_v TO 'mail_postfix'@'%';
FLUSH PRIVILEGES;
SQL
}

if [ "$DIALECT" = postgres ]; then SQL="$(sql_postgres)"; else SQL="$(sql_mysql)"; fi

if [ "$PRINT_SQL" = 1 ]; then
  echo "$SQL"
  exit 0
fi

if [ "$DIALECT" = postgres ]; then
  if command -v psql >/dev/null 2>&1; then
    echo "$SQL" | su -s /bin/sh postgres -c "psql -v ON_ERROR_STOP=1 -d '${POSTGRES_DATABASE:-container_creator}'"
  else
    echo "setup-mail-db-roles: psql not found — run with --print-sql and apply as a DBA." >&2
    exit 1
  fi
else
  if command -v mysql >/dev/null 2>&1; then
    echo "$SQL" | mysql
  else
    echo "setup-mail-db-roles: mysql client not found — run with --print-sql and apply as a DBA." >&2
    exit 1
  fi
fi

set_env_var MAIL_DOVECOT_DB_PASSWORD "$DOVECOT_PW"
set_env_var MAIL_POSTFIX_DB_PASSWORD "$POSTFIX_PW"
echo "setup-mail-db-roles: mail_dovecot and mail_postfix are ready; passwords stored in $ENV_FILE."
