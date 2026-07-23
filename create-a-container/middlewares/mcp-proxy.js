/**
 * Streaming reverse proxy for the MCP server (manager-control-program).
 *
 * The packaged MCP server listens on loopback (see
 * manager-control-program.service); the Manager exposes it at /mcp on its
 * public origin so MCP clients get TLS and a stable hostname for free, and
 * per-request Authorization headers flow: MCP client -> this proxy -> MCP
 * server -> back to this app's /api/v1 as a Bearer API key.
 *
 * Hand-rolled on node:http instead of a proxy dependency because the needs
 * are narrow but strict:
 *   - bodies must pass through untouched (mount BEFORE express.json, which
 *     would otherwise consume the stream);
 *   - responses must stream incrementally (MCP's streamable HTTP transport
 *     uses long-lived text/event-stream responses);
 *   - no timeout on the upstream socket (SSE streams idle between events).
 */

const http = require('http');
const https = require('https');

// Hop-by-hop headers are connection-scoped and must not be forwarded
// (RFC 9110 §7.6.1). `host` is excluded so node sets it from the target.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function filterHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * @param {string} targetBase Origin of the MCP server, e.g. "http://127.0.0.1:8100".
 *                            The request path is preserved (/mcp -> ${targetBase}/mcp).
 * @returns {import('express').RequestHandler}
 */
function createMcpProxy(targetBase) {
  const base = new URL(targetBase);
  const client = base.protocol === 'https:' ? https : http;
  const agent = new client.Agent({ keepAlive: true });

  return function mcpProxy(req, res) {
    // req.originalUrl is the full path+query as received (req.url would have
    // the /mcp mount prefix stripped by express).
    const target = new URL(req.originalUrl, base);

    const upstream = client.request(
      target,
      { method: req.method, headers: filterHeaders(req.headers), agent },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, filterHeaders(upstreamRes.headers));
        // flushHeaders so SSE clients see the stream open before any event.
        res.flushHeaders();
        upstreamRes.pipe(res);
      },
    );

    // SSE responses idle between events; never time the socket out.
    upstream.setTimeout(0);

    upstream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'mcp_unavailable', message: 'MCP server is unreachable' },
        }),
      );
    });

    // Client gone (or response finished) — release the upstream socket.
    res.on('close', () => upstream.destroy());

    req.pipe(upstream);
  };
}

module.exports = { createMcpProxy };
