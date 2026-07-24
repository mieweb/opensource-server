/**
 * Managed services: how to render, test, apply and reload each service's
 * configuration. Files are written atomically (temp file + rename) with
 * backup/rollback — if the test command rejects the new config, the
 * previous files are restored and the apply is reported as a failure at the
 * next check-in.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import ejs from 'ejs';
import { reloadOrRestartService, restartService, sighupService } from './system';
import { log, commandOutput } from './log';
import type { ApplyResult, SiteConfig } from './types';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

interface RenderedFile {
  dest: string;
  content: string;
}

export interface ManagedService {
  /** systemd unit name (also the key reported at check-in). */
  unit: string;
  /** Render all managed files. Returns null when there is nothing to manage
   * yet (e.g. dnsmasq before the site exists). */
  render(config: SiteConfig): Promise<RenderedFile[] | null>;
  /** Command that validates the staged config before it is kept. */
  test?: string[];
  /** Reload/restart after a successful apply. */
  reload(changedFiles: string[]): Promise<void>;
}

function renderTemplate(template: string, data: object): Promise<string> {
  return ejs.renderFile(path.join(TEMPLATES_DIR, template), data);
}

// Run a command, capturing its output. execFileSync with stdio 'pipe' attaches
// the captured stdout/stderr to the thrown error on failure (see commandOutput
// in log.ts), so callers can surface e.g. exactly why `nginx -t` rejected a
// config. Returns the combined stdout for successful runs.
function run(cmd: string[]): string {
  return execFileSync(cmd[0], cmd.slice(1), { stdio: 'pipe', encoding: 'utf8' });
}

export const services: ManagedService[] = [
  {
    unit: 'nginx',
    async render(config) {
      return [{
        dest: '/etc/nginx/nginx.conf',
        content: await renderTemplate('nginx.conf.ejs', config.nginx),
      }];
    },
    test: ['nginx', '-t'],
    reload() {
      return reloadOrRestartService('nginx');
    },
  },
  {
    unit: 'dnsmasq',
    async render(config) {
      const site = config.site;
      // Skip dnsmasq management until the site's DHCP/DNS settings are fully
      // configured — the templates need all of these fields.
      if (!site?.internalDomain || !site.dhcpRange || !site.subnetMask
        || !site.gateway || !site.dnsForwarders) {
        return null;
      }
      const data = { site };
      return [
        { dest: '/etc/dnsmasq.conf', content: await renderTemplate('dnsmasq/conf.ejs', data) },
        { dest: '/var/lib/dnsmasq/dhcp-hosts', content: await renderTemplate('dnsmasq/dhcp-hosts.ejs', data) },
        { dest: '/var/lib/dnsmasq/hosts', content: await renderTemplate('dnsmasq/hosts.ejs', data) },
        { dest: '/var/lib/dnsmasq/dhcp-opts', content: await renderTemplate('dnsmasq/dhcp-opts.ejs', data) },
        { dest: '/var/lib/dnsmasq/servers', content: await renderTemplate('dnsmasq/servers.ejs', data) },
      ];
    },
    test: ['dnsmasq', '--test'],
    reload(changedFiles) {
      // The main config requires a full restart; the auxiliary files under
      // /var/lib/dnsmasq are re-read on SIGHUP.
      if (changedFiles.includes('/etc/dnsmasq.conf')) {
        return restartService('dnsmasq');
      }
      return sighupService('dnsmasq');
    },
  },
];

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Write via temp file + rename so a crash mid-write can never leave a
// truncated config on disk.
function writeFileAtomic(dest: string, content: string): void {
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, dest);
}

export async function applyService(svc: ManagedService, config: SiteConfig): Promise<ApplyResult> {
  log.debug(`${svc.unit}: rendering config`);
  const files = await svc.render(config);
  if (!files) {
    log.debug(`${svc.unit}: nothing to manage yet, skipping`);
    return 'success';
  }

  const current = new Map(files.map((f) => [f.dest, readIfExists(f.dest)]));
  const changed = files.filter((f) => current.get(f.dest) !== f.content).map((f) => f.dest);
  if (changed.length === 0) {
    log.debug(`${svc.unit}: config unchanged, nothing to do`);
    return 'success';
  }

  log.info(`${svc.unit}: ${changed.length} file(s) changed, applying: ${changed.join(', ')}`);

  // Stage the new files (previous contents kept in memory for rollback).
  for (const f of files) {
    fs.mkdirSync(path.dirname(f.dest), { recursive: true });
    writeFileAtomic(f.dest, f.content);
    log.debug(`${svc.unit}: wrote ${f.dest}`);
  }

  const rollback = () => {
    for (const [dest, prev] of current) {
      if (prev === null) fs.rmSync(dest, { force: true });
      else writeFileAtomic(dest, prev);
    }
    log.debug(`${svc.unit}: rolled back to previous config`);
  };

  if (svc.test) {
    const testCmd = svc.test.join(' ');
    log.debug(`${svc.unit}: testing config with \`${testCmd}\``);
    try {
      const out = run(svc.test);
      const trimmed = out.trim();
      if (trimmed) log.debug(`${svc.unit}: config test output:\n${trimmed}`);
      log.info(`${svc.unit}: config test passed`);
    } catch (err) {
      rollback();
      // Surface the actual validator output (e.g. the nginx line/column that
      // was rejected) — that's the whole point of running the test, and it's
      // otherwise lost since the command's stdio is piped.
      const output = commandOutput(err);
      log.error(`${svc.unit}: config test failed (\`${testCmd}\`), rolled back: ${(err as Error).message}`);
      if (output) log.error(`${svc.unit}: config test output:\n${output}`);
      return 'failure';
    }
  }

  try {
    log.debug(`${svc.unit}: reloading service`);
    await svc.reload(changed);
    log.info(`${svc.unit}: reloaded`);
  } catch (err) {
    // The new config passed its test but the service couldn't pick it up:
    // restore the previous files and reload again (best effort) so the
    // service keeps running the last known-good config.
    rollback();
    await svc.reload(changed).catch((reErr) => {
      log.error(`${svc.unit}: reload after rollback also failed: ${(reErr as Error).message}`);
    });
    log.error(`${svc.unit}: reload failed, rolled back: ${(err as Error).message}`);
    return 'failure';
  }

  log.info(`${svc.unit}: applied ${changed.length} file(s)`);
  return 'success';
}
