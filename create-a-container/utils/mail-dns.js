/**
 * Mail DNS records + Check DNS (issue #67).
 *
 * buildMailDnsRecords: the records an admin must publish for a domain.
 * checkMailDns: verifies them against public resolvers. Send gate =
 * SPF + DKIM + DMARC; receive gate = MX. PTR problems are warnings only.
 *
 * SPF evaluation is deliberately record-based per the plan: pass when the
 * record's ip4 mechanisms cover the mail IP, or when it contains the
 * configured mail_spf_include. (Full RFC 7208 evaluation — a/mx/redirect
 * chasing — is a follow-up.)
 */

const dns = require('dns');
const { dkimDnsRecordValue } = require('./dkim');

const DEFAULT_RESOLVERS = ['1.1.1.1', '8.8.8.8'];

/**
 * @param {object} p
 * @param {string} p.domain
 * @param {string|null} p.mailIp - externalIp of the mail host's site
 * @param {string|null} p.mailHostname - mail_hostname setting (MX target / HELO)
 * @param {string|null} p.spfInclude - mail_spf_include setting (required with a relayhost)
 * @param {{selector: string, publicKey: string}|null} p.dkimKey
 * @returns {Array<{type: string, name: string, value: string}>}
 */
function buildMailDnsRecords({ domain, mailIp, mailHostname, spfInclude, dkimKey }) {
  const spfParts = ['v=spf1'];
  if (mailIp) spfParts.push(`ip4:${mailIp}`);
  if (spfInclude) spfParts.push(`include:${spfInclude}`);
  spfParts.push('-all');

  const records = [
    { type: 'TXT', name: domain, value: spfParts.join(' ') },
  ];
  if (dkimKey) {
    records.push({
      type: 'TXT',
      name: `${dkimKey.selector}._domainkey.${domain}`,
      value: dkimDnsRecordValue(dkimKey.publicKey),
    });
  }
  records.push({
    type: 'TXT',
    name: `_dmarc.${domain}`,
    value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
  });
  if (mailHostname) {
    records.push({ type: 'MX', name: domain, value: `10 ${mailHostname}.` });
  }
  return records;
}

/** ip4:<addr>[/<prefix>] mechanism match for an IPv4 address. */
function ipv4InCidr(ip, cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = prefixStr === undefined ? 32 : parseInt(prefixStr, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const toInt = (addr) => {
    const parts = addr.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const ipInt = toInt(ip);
  const baseInt = toInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Record-based SPF pass: any ip4 mechanism covers mailIp, or the record
 * contains include:<spfInclude>.
 */
function spfRecordPasses(record, { mailIp, spfInclude }) {
  const mechanisms = record.trim().split(/\s+/).slice(1);
  for (const mech of mechanisms) {
    const m = mech.replace(/^\+/, '');
    if (mailIp && m.toLowerCase().startsWith('ip4:') && ipv4InCidr(mailIp, m.slice(4))) return true;
    if (spfInclude && m.toLowerCase() === `include:${spfInclude.toLowerCase()}`) return true;
  }
  return false;
}

/** Strip quotes/whitespace variations; TXT comes back as chunk arrays. */
function joinTxt(chunks) {
  return chunks.join('');
}

/** Normalize a DKIM TXT record's p= value for comparison. */
function dkimRecordPublicKey(record) {
  const match = /(?:^|;)\s*p=([^;]*)/.exec(record);
  return match ? match[1].replace(/\s+/g, '') : null;
}

function makeResolver(resolvers) {
  const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers(resolvers && resolvers.length ? resolvers : DEFAULT_RESOLVERS);
  return resolver;
}

async function resolveTxtSafe(resolver, name) {
  try {
    return (await resolver.resolveTxt(name)).map(joinTxt);
  } catch {
    return [];
  }
}

/**
 * Reverse-lookup an IP and forward-confirm the result. Used by Check DNS
 * warnings and by GET /mail/ptr to suggest a mail_hostname.
 * @returns {Promise<{name: string|null, forwardConfirmed: boolean}>}
 */
async function lookupPtr({ ip, resolvers, resolver }) {
  const r = resolver || makeResolver(resolvers);
  try {
    const names = await r.reverse(ip);
    const name = names[0] || null;
    let forwardConfirmed = false;
    if (name) {
      try {
        forwardConfirmed = (await r.resolve4(name)).includes(ip);
      } catch { /* not forward-confirmed */ }
    }
    return { name, forwardConfirmed };
  } catch {
    return { name: null, forwardConfirmed: false };
  }
}

/**
 * Run the Check DNS pass for a domain.
 *
 * @param {object} p
 * @param {string} p.domain
 * @param {string|null} p.mailIp
 * @param {string|null} p.mailHostname
 * @param {string|null} p.spfInclude
 * @param {{selector: string, publicKey: string}|null} p.dkimKey
 * @param {string[]} [p.resolvers] - mail_dns_check_resolvers setting
 * @param {object} [p.resolver] - injectable for tests
 * @returns {Promise<object>} stored as ExternalDomains.mailDnsCheckResult:
 *   { checkedAt, spf|dkim|dmarc|mx: { pass, ... }, ptr: {...}, warnings: [] }
 */
async function checkMailDns({ domain, mailIp, mailHostname, spfInclude, dkimKey, resolvers, resolver }) {
  const r = resolver || makeResolver(resolvers);
  const result = { checkedAt: new Date().toISOString(), warnings: [] };

  // SPF
  const txt = await resolveTxtSafe(r, domain);
  const spfRecord = txt.find((t) => /^v=spf1(\s|$)/i.test(t)) || null;
  result.spf = {
    pass: !!(spfRecord && spfRecordPasses(spfRecord, { mailIp, spfInclude })),
    record: spfRecord,
  };
  if (!mailIp) result.warnings.push('No mail IP known yet — no agent holds the mail-host claim.');

  // DKIM
  if (dkimKey) {
    const dkimTxt = await resolveTxtSafe(r, `${dkimKey.selector}._domainkey.${domain}`);
    const published = dkimTxt.map(dkimRecordPublicKey).find((p) => p) || null;
    result.dkim = {
      pass: !!published && published === dkimKey.publicKey.replace(/\s+/g, ''),
      selector: dkimKey.selector,
      published: !!published,
    };
  } else {
    result.dkim = { pass: false, selector: null, published: false };
    result.warnings.push('No active DKIM key for this domain.');
  }

  // DMARC
  const dmarcTxt = await resolveTxtSafe(r, `_dmarc.${domain}`);
  const dmarcRecord = dmarcTxt.find((t) => /^v=DMARC1(\s*;|$)/i.test(t)) || null;
  result.dmarc = { pass: !!dmarcRecord, record: dmarcRecord };

  // MX → must resolve to the mail IP (receive gate)
  let mxPass = false;
  let mxHosts = [];
  try {
    const mx = await r.resolveMx(domain);
    mxHosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
    for (const host of mxHosts) {
      try {
        const addrs = await r.resolve4(host);
        if (mailIp && addrs.includes(mailIp)) { mxPass = true; break; }
      } catch { /* try next exchange */ }
    }
  } catch { /* no MX */ }
  result.mx = { pass: mxPass, hosts: mxHosts };

  // PTR (warnings only)
  if (mailIp) {
    const ptr = await lookupPtr({ ip: mailIp, resolver: r });
    result.ptr = ptr;
    if (!ptr.name) result.warnings.push(`No PTR record for ${mailIp}.`);
    else if (!ptr.forwardConfirmed) result.warnings.push(`PTR ${ptr.name} is not forward-confirmed.`);
    else if (mailHostname && ptr.name.toLowerCase() !== mailHostname.toLowerCase()) {
      result.warnings.push(`PTR ${ptr.name} does not match mail_hostname ${mailHostname}.`);
    }
  }

  return result;
}

module.exports = {
  DEFAULT_RESOLVERS,
  buildMailDnsRecords,
  checkMailDns,
  lookupPtr,
  // exported for tests
  ipv4InCidr,
  spfRecordPasses,
  dkimRecordPublicKey,
};
