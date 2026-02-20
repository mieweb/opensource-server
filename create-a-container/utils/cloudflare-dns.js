const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function headers(apiEmail, apiKey) {
  return {
    'X-Auth-Email': apiEmail,
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

async function cfFetch(apiEmail, apiKey, path, options = {}) {
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: { ...headers(apiEmail, apiKey), ...options.headers }
  });
  const body = await res.json();
  if (!body.success) {
    const msgs = (body.errors || []).map(e => e.message).join('; ');
    throw new Error(`Cloudflare API error (${path}): ${msgs}`);
  }
  return body;
}

async function getZoneId(apiEmail, apiKey, domainName) {
  // Walk up the domain hierarchy to find the matching Cloudflare zone
  // e.g. for "sub.example.com", try "sub.example.com" then "example.com"
  const parts = domainName.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const body = await cfFetch(apiEmail, apiKey, `/zones?name=${encodeURIComponent(candidate)}&status=active`);
    if (body.result && body.result.length > 0) {
      return body.result[0].id;
    }
  }
  throw new Error(`No active Cloudflare zone found for domain: ${domainName}`);
}

async function createARecord(apiEmail, apiKey, zoneId, fqdn, ip) {
  return cfFetch(apiEmail, apiKey, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name: fqdn, content: ip, ttl: 1, proxied: false })
  });
}

async function deleteARecord(apiEmail, apiKey, zoneId, fqdn) {
  const body = await cfFetch(apiEmail, apiKey,
    `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(fqdn)}`);
  for (const record of body.result || []) {
    await cfFetch(apiEmail, apiKey, `/zones/${zoneId}/dns_records/${record.id}`, {
      method: 'DELETE'
    });
  }
}

/**
 * Manage cross-site DNS records for HTTP services.
 * Logs failures with full detail but never throws — returns warnings array.
 */
async function manageDnsRecords(services, site, action = 'create') {
  const warnings = [];
  for (const service of services) {
    const domain = service.ExternalDomain || service.externalDomain;
    if (!domain) continue;
    if (domain.siteId === site.id) continue; // default site — DNS assumed pre-configured
    if (!domain.cloudflareApiEmail || !domain.cloudflareApiKey) {
      warnings.push(`No Cloudflare credentials for domain ${domain.name} — skipping DNS ${action}`);
      continue;
    }
    if (!site.externalIp && action === 'create') {
      warnings.push(`Site "${site.name}" has no externalIp — cannot create DNS record for ${service.externalHostname}.${domain.name}`);
      continue;
    }

    const fqdn = `${service.externalHostname}.${domain.name}`;
    try {
      const zoneId = await getZoneId(domain.cloudflareApiEmail, domain.cloudflareApiKey, domain.name);
      if (action === 'create') {
        await createARecord(domain.cloudflareApiEmail, domain.cloudflareApiKey, zoneId, fqdn, site.externalIp);
        console.log(`[DNS] Created A record: ${fqdn} → ${site.externalIp}`);
      } else {
        await deleteARecord(domain.cloudflareApiEmail, domain.cloudflareApiKey, zoneId, fqdn);
        console.log(`[DNS] Deleted A record: ${fqdn}`);
      }
    } catch (err) {
      const detail = `[DNS] Failed to ${action} A record for ${fqdn} (domain=${domain.name}, ` +
        `apiEmail=${domain.cloudflareApiEmail}, siteIp=${site.externalIp || 'none'}): ${err.message}`;
      console.error(detail);
      warnings.push(`DNS record for ${fqdn} could not be ${action}d — contact your administrator.`);
    }
  }
  return warnings;
}

module.exports = { getZoneId, createARecord, deleteARecord, manageDnsRecords };
