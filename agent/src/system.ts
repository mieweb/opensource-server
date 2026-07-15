/** Host system info: primary IPv4 address and systemd service states. */

import os from 'os';
import { execFileSync } from 'child_process';

/** First non-internal IPv4 address, or null when none is configured. */
export function getPrimaryIpv4(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

/** systemd ActiveState for a unit (active, inactive, failed, ...). */
export function getServiceState(unit: string): string {
  try {
    const out = execFileSync('systemctl', ['show', '--property=ActiveState', '--value', unit], {
      encoding: 'utf8',
    });
    return out.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
