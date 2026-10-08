/**
 * Unit tests for utils/mail-dns.js — record building and the Check DNS
 * pass/fail gates, with an injected fake resolver (no network).
 */

const {
  buildMailDnsRecords,
  checkMailDns,
  ipv4InCidr,
  spfRecordPasses,
  dkimRecordPublicKey,
} = require('../mail-dns');

const DKIM = { selector: 'os20261008', publicKey: 'MIIBIjANBgkq+TESTKEY' };

function fakeResolver({ txt = {}, mx = [], a = {}, ptr = {} } = {}) {
  return {
    resolveTxt: async (name) => {
      if (!(name in txt)) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
      return txt[name].map((record) => [record]);
    },
    resolveMx: async () => {
      if (!mx.length) { const e = new Error('ENODATA'); e.code = 'ENODATA'; throw e; }
      return mx;
    },
    resolve4: async (host) => {
      if (!(host in a)) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
      return a[host];
    },
    reverse: async (ip) => {
      if (!(ip in ptr)) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
      return ptr[ip];
    },
  };
}

describe('buildMailDnsRecords', () => {
  test('produces SPF, DKIM, DMARC, and MX records', () => {
    const records = buildMailDnsRecords({
      domain: 'example.com',
      mailIp: '203.0.113.9',
      mailHostname: 'mail.example.com',
      spfInclude: null,
      dkimKey: DKIM,
    });
    expect(records).toEqual([
      { type: 'TXT', name: 'example.com', value: 'v=spf1 ip4:203.0.113.9 -all' },
      { type: 'TXT', name: 'os20261008._domainkey.example.com', value: `v=DKIM1; k=rsa; p=${DKIM.publicKey}` },
      { type: 'TXT', name: '_dmarc.example.com', value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com' },
      { type: 'MX', name: 'example.com', value: '10 mail.example.com.' },
    ]);
  });

  test('adds include when a relayhost SPF include is configured', () => {
    const [spf] = buildMailDnsRecords({
      domain: 'example.com', mailIp: '203.0.113.9', mailHostname: null,
      spfInclude: 'relay.example.net', dkimKey: null,
    });
    expect(spf.value).toBe('v=spf1 ip4:203.0.113.9 include:relay.example.net -all');
  });
});

describe('spf matching', () => {
  test('ipv4InCidr handles plain addresses and prefixes', () => {
    expect(ipv4InCidr('203.0.113.9', '203.0.113.9')).toBe(true);
    expect(ipv4InCidr('203.0.113.9', '203.0.113.0/24')).toBe(true);
    expect(ipv4InCidr('203.0.114.9', '203.0.113.0/24')).toBe(false);
    expect(ipv4InCidr('not-an-ip', '203.0.113.0/24')).toBe(false);
  });

  test('spfRecordPasses on ip4 or the configured include', () => {
    expect(spfRecordPasses('v=spf1 ip4:203.0.113.0/24 -all', { mailIp: '203.0.113.9' })).toBe(true);
    expect(spfRecordPasses('v=spf1 include:relay.net -all', { mailIp: '203.0.113.9', spfInclude: 'relay.net' })).toBe(true);
    expect(spfRecordPasses('v=spf1 a mx -all', { mailIp: '203.0.113.9' })).toBe(false);
  });
});

test('dkimRecordPublicKey extracts and de-whitespaces p=', () => {
  expect(dkimRecordPublicKey('v=DKIM1; k=rsa; p=AB CD')).toBe('ABCD');
  expect(dkimRecordPublicKey('v=DKIM1; k=rsa')).toBeNull();
});

describe('checkMailDns', () => {
  const happyZone = {
    txt: {
      'example.com': ['v=spf1 ip4:203.0.113.9 -all'],
      'os20261008._domainkey.example.com': [`v=DKIM1; k=rsa; p=${DKIM.publicKey}`],
      '_dmarc.example.com': ['v=DMARC1; p=quarantine'],
    },
    mx: [{ exchange: 'mail.example.com', priority: 10 }],
    a: { 'mail.example.com': ['203.0.113.9'] },
    ptr: { '203.0.113.9': ['mail.example.com'] },
  };
  const params = {
    domain: 'example.com',
    mailIp: '203.0.113.9',
    mailHostname: 'mail.example.com',
    spfInclude: null,
    dkimKey: DKIM,
  };

  test('all green when every record is correct', async () => {
    const result = await checkMailDns({ ...params, resolver: fakeResolver(happyZone) });
    expect(result.spf.pass).toBe(true);
    expect(result.dkim.pass).toBe(true);
    expect(result.dmarc.pass).toBe(true);
    expect(result.mx.pass).toBe(true);
    expect(result.ptr).toEqual({ name: 'mail.example.com', forwardConfirmed: true });
    expect(result.warnings).toEqual([]);
  });

  test('fails each gate independently on an empty zone', async () => {
    const result = await checkMailDns({ ...params, resolver: fakeResolver() });
    expect(result.spf.pass).toBe(false);
    expect(result.dkim.pass).toBe(false);
    expect(result.dmarc.pass).toBe(false);
    expect(result.mx.pass).toBe(false);
    expect(result.warnings).toContain('No PTR record for 203.0.113.9.');
  });

  test('wrong DKIM key fails even when a record is published', async () => {
    const zone = {
      ...happyZone,
      txt: { ...happyZone.txt, 'os20261008._domainkey.example.com': ['v=DKIM1; k=rsa; p=SOMEOTHERKEY'] },
    };
    const result = await checkMailDns({ ...params, resolver: fakeResolver(zone) });
    expect(result.dkim.pass).toBe(false);
    expect(result.dkim.published).toBe(true);
  });

  test('warns when PTR does not match mail_hostname', async () => {
    const zone = {
      ...happyZone,
      ptr: { '203.0.113.9': ['other.example.net'] },
      a: { ...happyZone.a, 'other.example.net': ['203.0.113.9'] },
    };
    const result = await checkMailDns({ ...params, resolver: fakeResolver(zone) });
    expect(result.warnings).toContain('PTR other.example.net does not match mail_hostname mail.example.com.');
  });
});
