#!/usr/bin/env bash
# This script runs as root, reads PID 1's environment variables and inserts
# them into /etc/environment. This allows the container runtime (LXC or Docker)
# to set environment variables for system containers, that are then processed
# by pam_env.so such that all processes in the container inhert those variables
# We filter out certain variables that may cause issues with user sessions.
</proc/1/environ tr '\0' '\n' | grep -vE '^(HOME)' >/etc/environment
