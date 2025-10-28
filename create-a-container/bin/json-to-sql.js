#!/usr/bin/env node
"use strict";

// Usage: node bin/json-to-sql.js <input.json> [--dry-run]

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const servicesLookup = require('../data/services.json');

const PROXMOX_URL = process.env.PROXMOX_URL;
const PROXMOX_USER = process.env.PROXMOX_USER;
const PROXMOX_PASSWORD = process.env.PROXMOX_PASSWORD;

let pmxAuth = null; // {ticket, CSRF}

const argv = process.argv.slice(2);
if (argv.length < 1) {
  console.error('Usage: json-to-sql.js <input.json> [--dry-run]');
  process.exit(2);
}

const inputPath = path.resolve(argv[0]);
const dryRun = argv.includes('--dry-run');

async function pmxFetch(pathSuffix, opts = {}) {
  console.log('pmxFetch', pathSuffix);
  if (!PROXMOX_URL) throw new Error('Proxmox URL not configured');
  const url = PROXMOX_URL.replace(/\/$/, '') + pathSuffix;
  const headers = opts.headers || {};
  if (pmxAuth && pmxAuth.ticket) {
    headers['Cookie'] = `PVEAuthCookie=${pmxAuth.ticket}`;
    if (pmxAuth.CSRFPreventionToken) headers['CSRFPreventionToken'] = pmxAuth.CSRFPreventionToken;
  }
  const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Proxmox fetch ${url} failed: ${res.status} ${res.statusText} - ${txt}`);
  }
  return res.json();
}

async function pmxLogin() {
  if (!PROXMOX_URL || !PROXMOX_USER || !PROXMOX_PASSWORD) return null;
  if (pmxAuth && pmxAuth.ticket) return pmxAuth;
  const body = new URLSearchParams();
  body.append('username', PROXMOX_USER);
  body.append('password', PROXMOX_PASSWORD);
  const url = PROXMOX_URL.replace(/\/$/, '') + '/api2/json/access/ticket';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Proxmox login failed: ${res.status} ${res.statusText} - ${txt}`);
  }
  const j = await res.json();
  pmxAuth = {
    ticket: j.data.ticket,
    CSRFPreventionToken: j.data.CSRFPreventionToken
  };
  return pmxAuth;
}

function parseNet0Config(net0) {
  // expected formats like: "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:C8:3C:2D,ip=10.15.16.246/24"
  const out = {};
  if (!net0 || typeof net0 !== 'string') return out;
  const parts = net0.split(',');
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    if (!k) continue;
    const v = rest.join('=');
    if (k === 'hwaddr') out.mac = v;
    if (k === 'ip') {
      const ip = v.split('/')[0];
      out.ip = ip;
    }
  }
  return out;
}

async function lookupProxmoxByHostname(hostname) {
  await pmxLogin();

  // list LXC resources
  const res = await pmxFetch('/api2/json/cluster/resources?type=vm');
  const list = res.data || [];
  const needle = String(hostname).toLowerCase();
  const found = list.find(r => (r.name && String(r.name).toLowerCase() === needle) || (r.vname && String(r.vname).toLowerCase() === needle));
  if (!found) throw new Error(`Proxmox: no LXC container found with hostname ${hostname}`);
  const node = found.node;
  const vmid = found.vmid || found.vmid || found.vmid; // vmid field
  const out = { ctid: vmid };
  const cfg = await pmxFetch(`/api2/json/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/config`);
  const cfgData = cfg.data || {};
  if (cfgData.net0) {
    const parsed = parseNet0Config(cfgData.net0);
    if (parsed.mac) out.mac = parsed.mac;
    if (parsed.ip) out.ip = parsed.ip;
  }
  if (!out.ip) {
    // try status/current for IP hints
    const st = await pmxFetch(`/api2/json/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/status/current`);
    const stData = st.data || {};
    // scan for the first IPv4-looking string in the JSON
    const text = JSON.stringify(stData);
    const m = text.match(/(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}/);
    if (m) out.ip = m[0];
  }
  // try to get description/user if available
  if (cfgData.description) {
    // naive parse: look for user:NAME or owner:NAME
    const mm = cfgData.description.match(/(?:user|owner):\s*([A-Za-z0-9_\-]+)/i);
    if (mm) out.user = mm[1];
    const osm = cfgData.description.match(/os[_ -]?release:\s*([A-Za-z0-9._\-]+)/i);
    if (osm) out.os_release = osm[1];
  }
  return out;
}

function normalizeServiceKey(k) {
  return String(k).toLowerCase();
}

function mapPortEntryToService(hostname, key, value) {
  // key: service name like 'http' or 'ssh'
  // value: external port number
  const k = normalizeServiceKey(key);
  if (k === 'http') {
    return {
      type: 'http',
      internalPort: value,
      externalPort: null,
      tls: null,
      externalHostname: hostname
    };
  }

  const lookup = servicesLookup[k];
  if (lookup) {
    return {
      type: lookup.protocol === 'udp' ? 'udp' : 'tcp',
      internalPort: lookup.port,
      externalPort: value,
      tls: lookup.protocol === 'tcp' ? false : null,
      externalHostname: null
    };
  }

  // fallback: assume tcp, use the provided value as both internal and external
  return {
    type: 'tcp',
    internalPort: value,
    externalPort: value,
    tls: false,
    externalHostname: null
  };
}

async function run() {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);

  // If dry-run, only print what would be created
  if (dryRun) {
    for (const [hostname, obj] of Object.entries(data)) {
      // If fields missing and Proxmox creds provided, try to fill them (dry-run lookup)
      if ((obj.user === undefined || obj.os_release === undefined || obj.ctid === undefined || obj.mac === undefined || obj.ip === undefined) && (PROXMOX_URL && PROXMOX_USER && PROXMOX_PASSWORD)) {
        const pmx = await lookupProxmoxByHostname(hostname);
        if (pmx.ctid && obj.ctid === undefined) obj.ctid = pmx.ctid;
        if (pmx.mac && obj.mac === undefined) obj.mac = pmx.mac;
        if (pmx.ip && obj.ip === undefined) obj.ip = pmx.ip;
        if (pmx.user && obj.user === undefined) obj.user = pmx.user;
        if (pmx.os_release && obj.os_release === undefined) obj.os_release = pmx.os_release;
      }

      console.log(`Container: hostname=${hostname}`);
      console.log(`  ipv4Address=${obj.ip}`);
      console.log(`  username=${obj.user}`);
      console.log(`  osRelease=${obj.os_release}`);
      console.log(`  containerId=${obj.ctid}`);
      console.log(`  macAddress=${obj.mac}`);
      if (obj.ports) {
        for (const [k, v] of Object.entries(obj.ports)) {
          const svc = mapPortEntryToService(hostname, k, v);
          console.log(`  Service: type=${svc.type} internalPort=${svc.internalPort} externalPort=${svc.externalPort} tls=${svc.tls} externalHostname=${svc.externalHostname}`);
        }
      }
    }
    return;
  }

  // Real DB mode: use Sequelize models
  const models = require(path.resolve(__dirname, '../models'));
  const { Container, Service, Sequelize } = models;

  for (const [hostname, obj] of Object.entries(data)) {
    // If fields missing and Proxmox creds provided, try to fill them
    if ((obj.user === undefined || obj.os_release === undefined || obj.ctid === undefined || obj.mac === undefined || obj.ip === undefined) && (PROXMOX_URL && PROXMOX_USER && PROXMOX_PASSWORD)) {
      const pmx = await lookupProxmoxByHostname(hostname);
      if (pmx.ctid && obj.ctid === undefined) obj.ctid = pmx.ctid;
      if (pmx.mac && obj.mac === undefined) obj.mac = pmx.mac;
      if (pmx.ip && obj.ip === undefined) obj.ip = pmx.ip;
      if (pmx.user && obj.user === undefined) obj.user = pmx.user;
      if (pmx.os_release && obj.os_release === undefined) obj.os_release = pmx.os_release;
    }

    // Upsert Container by hostname
    // case-insensitive hostname match
    let container = await Container.findOne({
      where: Sequelize.where(Sequelize.fn('lower', Sequelize.col('hostname')), hostname.toLowerCase())
    });
    if (!container) {
      container = await Container.create({
        hostname,
        ipv4Address: obj.ip,
        username: obj.user || '',
        osRelease: obj.os_release,
        containerId: obj.ctid,
        macAddress: obj.mac
      });
      console.log(`Created container ${hostname}`);
    } else {
      await container.update({
        ipv4Address: obj.ip,
        username: obj.user || '',
        osRelease: obj.os_release,
        containerId: obj.ctid,
        macAddress: obj.mac
      });
      console.log(`Updated container ${hostname}`);
    }

    // Create service rows
    if (obj.ports) {
      for (const [k, v] of Object.entries(obj.ports)) {
        const svc = mapPortEntryToService(hostname, k, v);
        const serviceRow = await Service.create({
          // Service.containerId references the Container primary key (id)
          containerId: container.id,
          type: svc.type,
          internalPort: svc.internalPort,
          externalPort: svc.externalPort,
          tls: svc.tls,
          externalHostname: svc.externalHostname
        });
        console.log(`Created service ${serviceRow.id} on container ${hostname}`);
      }
    }
  }
}

run().catch(err => {
  console.error('ERROR', err);
  process.exit(1);
});
