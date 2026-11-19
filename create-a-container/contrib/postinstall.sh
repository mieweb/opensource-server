#!/bin/sh
set -e

UNITS="container-creator.service job-runner.service"

# Mail stack DB access on a local Postgres cluster (the manager image). Runs at
# image build and on every upgrade, so managers built before the mail stack
# catch up. Idempotent.
#  - pg_ident maps the postfix/opensource-mail/dovecot OS users onto the
#    read-only mail_* roles (peer auth, no passwords); the pg_hba rules must
#    precede the catch-all "local all all peer", hence inserted at the top.
#  - CREATEROLE lets the role migrations create mail_postfix/mail_dovecot.
setup_local_postgres_mail() {
    for conf in /etc/postgresql/*/main; do
        [ -f "$conf/pg_hba.conf" ] || continue
        changed=
        for role in mail_dovecot mail_postfix; do
            line="local all $role peer map=osmail"
            if ! grep -qxF "$line" "$conf/pg_hba.conf"; then
                sed -i "1i $line" "$conf/pg_hba.conf"
                changed=1
            fi
        done
        for map in "postfix mail_postfix" "opensource-mail mail_postfix" "dovecot mail_dovecot"; do
            if ! grep -qxF "osmail $map" "$conf/pg_ident.conf"; then
                echo "osmail $map" >>"$conf/pg_ident.conf"
                changed=1
            fi
        done
        if [ -n "$changed" ] && [ -d /run/systemd/system ]; then
            systemctl reload postgresql || true
        fi
    done

    # Only once container-creator-init has created the local app user.
    [ -d /run/systemd/system ] && [ -f /etc/default/container-creator ] || return 0
    POSTGRES_USER=$(sed -n 's/^POSTGRES_USER=//p' /etc/default/container-creator)
    POSTGRES_HOST=$(sed -n 's/^POSTGRES_HOST=//p' /etc/default/container-creator)
    if [ -n "$POSTGRES_USER" ] && [ "$POSTGRES_HOST" = localhost ]; then
        runuser -u postgres -- psql -qc "ALTER ROLE \"$POSTGRES_USER\" CREATEROLE" \
            || echo "opensource-server: could not grant CREATEROLE to $POSTGRES_USER" >&2
    fi
}
setup_local_postgres_mail

# Nothing to do without systemctl (non-systemd container/chroot).
command -v systemctl >/dev/null 2>&1 || exit 0

# `systemctl enable` only creates static symlinks, so it works during an image
# build too
systemctl enable $UNITS

# daemon-reload and restart need a running systemd; skip them at build time.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload
    systemctl restart $UNITS
fi

exit 0
