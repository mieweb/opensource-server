/**
 * Managed services: how to render, test, apply and reload each service's
 * configuration. Files are written in place with backup/rollback — if the
 * test command rejects the new config, the previous files are restored and
 * the apply is reported as a failure at the next check-in.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import ejs from 'ejs';
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
  reload(changedFiles: string[]): void;
}

function renderTemplate(template: string, data: object): Promise<string> {
  return ejs.renderFile(path.join(TEMPLATES_DIR, template), data);
}

function run(cmd: string[]): void {
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'pipe' });
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
      run(['systemctl', 'reload-or-restart', 'nginx']);
    },
  },
  {
    unit: 'dnsmasq',
    async render(config) {
      if (!config.site) return null;
      const data = { site: config.site };
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
        run(['systemctl', 'restart', 'dnsmasq']);
      } else {
        run(['systemctl', 'kill', '--signal=SIGHUP', 'dnsmasq']);
      }
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

export async function applyService(svc: ManagedService, config: SiteConfig): Promise<ApplyResult> {
  const files = await svc.render(config);
  if (!files) return 'success';

  const current = new Map(files.map((f) => [f.dest, readIfExists(f.dest)]));
  const changed = files.filter((f) => current.get(f.dest) !== f.content).map((f) => f.dest);
  if (changed.length === 0) return 'success';

  // Stage the new files (previous contents kept in memory for rollback).
  for (const f of files) {
    fs.mkdirSync(path.dirname(f.dest), { recursive: true });
    fs.writeFileSync(f.dest, f.content);
  }

  const rollback = () => {
    for (const [dest, prev] of current) {
      if (prev === null) fs.rmSync(dest, { force: true });
      else fs.writeFileSync(dest, prev);
    }
  };

  if (svc.test) {
    try {
      run(svc.test);
    } catch (err) {
      rollback();
      console.error(`${svc.unit}: config test failed, rolled back: ${(err as Error).message}`);
      return 'failure';
    }
  }

  try {
    svc.reload(changed);
  } catch (err) {
    console.error(`${svc.unit}: reload failed: ${(err as Error).message}`);
    return 'failure';
  }

  console.log(`${svc.unit}: applied ${changed.length} file(s)`);
  return 'success';
}
