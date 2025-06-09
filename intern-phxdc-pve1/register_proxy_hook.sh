#!/bin/bash

# /var/lib/vz/snippets/register_proxy_hook.sh

set -x # Enable debug output
echo "DEBUG: Hook script /var/lib/vz/snippets/register_proxy_hook.sh started. Event: $2, CTID: $1" >> /tmp/hook_debug.log

# Hook script for container events
case "$2" in
    post-start) 
        echo "DEBUG: Calling register-container.sh for CTID: $1" >> /tmp/hook_debug.log
        /var/lib/vz/snippets/register-container.sh "$1" >> /tmp/hook_debug.log 2>&1
        echo "DEBUG: register-container.sh finished." >> /tmp/hook_debug.log
        ;;
    *)
        echo "DEBUG: Unhandled hook event: $2 for CTID: $1" >> /tmp/hook_debug.log
        ;;
esac
echo "DEBUG: Hook script /var/lib/vz/snippets/register_proxy_hook.sh finished." >> /tmp/hook_debug.log