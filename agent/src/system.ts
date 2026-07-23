/** Host system info and systemd unit control via the systemd D-Bus API. */

import os from 'os';
import dbus, { type MessageBus, type ProxyObject, type Variant } from '@particle/dbus-next';

/** First non-internal IPv4 address, or null when none is configured. */
export function getPrimaryIpv4(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

// --- systemd (org.freedesktop.systemd1 on the system bus) -------------------

const SYSTEMD = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';
const MANAGER_IFACE = 'org.freedesktop.systemd1.Manager';
const UNIT_IFACE = 'org.freedesktop.systemd1.Unit';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

const SIGHUP = 1;

/** The subset of org.freedesktop.DBus.Properties the agent uses. */
interface DbusProperties {
  Get(iface: string, prop: string): Promise<Variant<string>>;
}

/** The subset of org.freedesktop.systemd1.Manager the agent uses. */
interface SystemdManager {
  LoadUnit(name: string): Promise<string>;
  ReloadOrRestartUnit(name: string, mode: string): Promise<string>;
  RestartUnit(name: string, mode: string): Promise<string>;
  KillUnit(name: string, who: string, signal: number): Promise<void>;
  Subscribe(): Promise<void>;
  Unsubscribe(): Promise<void>;
  on(event: 'JobRemoved', listener: (id: number, job: unknown, unit: string, result: string) => void): void;
  removeListener(event: 'JobRemoved', listener: (...args: never[]) => void): void;
}

let bus: MessageBus | null = null;
let manager: SystemdManager | null = null;

function getBus(): MessageBus {
  if (!bus) bus = dbus.systemBus();
  return bus;
}

async function getManager(): Promise<SystemdManager> {
  if (!manager) {
    const obj: ProxyObject = await getBus().getProxyObject(SYSTEMD, SYSTEMD_PATH);
    manager = obj.getInterface(MANAGER_IFACE) as unknown as SystemdManager;
  }
  return manager;
}

/** Close the D-Bus connection so the oneshot process can exit. */
export function disconnectSystemBus(): void {
  bus?.disconnect();
  bus = null;
  manager = null;
}

/** systemctl-style shorthand: bare names get a .service suffix. */
function unitName(unit: string): string {
  return unit.includes('.') ? unit : `${unit}.service`;
}

/** systemd ActiveState for a unit (active, inactive, failed, ...). */
export async function getServiceState(unit: string): Promise<string> {
  try {
    const mgr = await getManager();
    const path = await mgr.LoadUnit(unitName(unit));
    const obj = await getBus().getProxyObject(SYSTEMD, path);
    const props = obj.getInterface(PROPERTIES_IFACE) as unknown as DbusProperties;
    const state = await props.Get(UNIT_IFACE, 'ActiveState');
    return state.value || 'unknown';
  } catch {
    // Any D-Bus failure just means the state can't be determined right now.
    return 'unknown';
  }
}

/** Enqueue a systemd job and wait for it to finish; throws unless the job
 * completes with result "done". */
async function runJob(method: 'ReloadOrRestartUnit' | 'RestartUnit', unit: string): Promise<void> {
  const mgr = await getManager();
  // JobRemoved is only broadcast to subscribed clients.
  await mgr.Subscribe();
  try {
    await new Promise<void>((resolve, reject) => {
      // The job can finish before the method call returns its path, so
      // removals seen in the meantime are buffered.
      const removedEarly = new Map<string, string>();
      let jobPath: string | undefined;

      const finish = (result: string) => {
        mgr.removeListener('JobRemoved', onRemoved);
        if (result === 'done') resolve();
        else reject(new Error(`systemd ${method} job for ${unit} finished with result "${result}"`));
      };
      const onRemoved = (_id: number, job: unknown, _unit: string, result: string) => {
        const path = String(job);
        if (jobPath === undefined) removedEarly.set(path, result);
        else if (path === jobPath) finish(result);
      };

      mgr.on('JobRemoved', onRemoved);
      mgr[method](unitName(unit), 'replace').then(
        (job) => {
          jobPath = String(job);
          const result = removedEarly.get(jobPath);
          if (result !== undefined) finish(result);
        },
        (err: Error) => {
          mgr.removeListener('JobRemoved', onRemoved);
          reject(err);
        },
      );
    });
  } finally {
    await mgr.Unsubscribe();
  }
}

/** Equivalent of `systemctl reload-or-restart <unit>`. */
export function reloadOrRestartService(unit: string): Promise<void> {
  return runJob('ReloadOrRestartUnit', unit);
}

/** Equivalent of `systemctl restart <unit>`. */
export function restartService(unit: string): Promise<void> {
  return runJob('RestartUnit', unit);
}

/** Equivalent of `systemctl kill --signal=SIGHUP <unit>` (main process). */
export async function sighupService(unit: string): Promise<void> {
  const mgr = await getManager();
  await mgr.KillUnit(unitName(unit), 'main', SIGHUP);
}
