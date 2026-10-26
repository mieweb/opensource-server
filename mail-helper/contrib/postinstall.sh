#!/bin/sh
set -e

# System users for the mail stack. vmail owns the Maildirs (Dovecot
# mail_uid/mail_gid); opensource-mail runs the milter daemon. The agent's
# mail service group manages directories, config, and the unit itself.
if ! id -u vmail >/dev/null 2>&1; then
    useradd --system --home-dir /var/vmail --create-home --shell /usr/sbin/nologin vmail
fi
if ! id -u opensource-mail >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin opensource-mail
fi

command -v systemctl >/dev/null 2>&1 || exit 0
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload
fi

exit 0
