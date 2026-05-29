"""Macro definitions for the Zensical macros extension.

Exposes URL variables sourced from environment variables so that documentation
can reference deployment-specific endpoints without hard-coding hostnames.

Variables:
    proxmox_url  — Proxmox web UI base URL (env: PROXMOX_URL)
    manager_url  — Manager web UI base URL (env: MANAGER_URL)
"""

from __future__ import annotations

import os

DEFAULT_PROXMOX_URL = "https://os.mieweb.org:8006"
DEFAULT_MANAGER_URL = "https://manager.os.mieweb.org"


def define_env(env) -> None:
    env.variables["proxmox_url"] = os.environ.get("PROXMOX_URL", DEFAULT_PROXMOX_URL)
    env.variables["manager_url"] = os.environ.get("MANAGER_URL", DEFAULT_MANAGER_URL)
