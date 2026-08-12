/**
 * Service last-access accounting for the opensource-server proxy.
 *
 * Loaded by nginx's js module (njs) in both the http and stream contexts.
 * Each proxied request/connection checks a shared dict whose entries expire
 * after 10 minutes (the zone's timeout=): a successful add() means no
 * report was sent in the current window, so this handler claims it —
 * atomically, across all workers — and POSTs to the manager, which stamps
 * the service's lastAccessedAt with its own clock. Everything is fail-open:
 * accounting can never affect the proxied request.
 *
 * Injected via nginx variables (see templates/nginx.conf.ejs):
 *   $osaas_service_id   Services.id for this vhost / stream server
 *   $osaas_manager_url  http-context: manager base URL, no trailing slash
 *   $osaas_api_key      http-context: admin API key; empty for the manager's
 *                       own agent, which reports over localhost without
 *                       credentials
 *   $osaas_relay_url    stream-context: localhost relay base URL — a unix
 *                       socket, so it carries the njs form
 *                       "http://unix:/path/to.sock:" (trailing colon
 *                       separates the socket path from the request URI)
 */

// `host` is only needed for unix-socket targets: njs would otherwise derive a
// Host header from the socket path ("host: /run/....sock:0"), which nginx
// rejects with 400. TCP targets pass it undefined and njs sets Host itself.
function report(base, apiKey, serviceId, host) {
  const headers = {};
  if (apiKey) {
    headers.Authorization = 'Bearer ' + apiKey;
  }
  if (host) {
    headers.Host = host;
  }
  return ngx.fetch(base + '/api/v1/services/' + serviceId + '/last-access', {
    method: 'POST',
    headers,
  });
}

/**
 * http handler (js_content in the internal mirror location). The mirror
 * subrequest runs in parallel with proxy_pass; awaiting the fetch keeps the
 * subrequest — never the client response — alive until the report lands.
 */
async function http_record(r) {
  try {
    const id = r.variables.osaas_service_id;
    if (id && ngx.shared.osaas_http.add(id, '1')) {
      const reply = await report(r.variables.osaas_manager_url, r.variables.osaas_api_key, id);
      if (reply.status !== 204) {
        r.log('osaas accounting: manager returned ' + reply.status + ' for service ' + id);
      }
    }
  } catch (e) {
    r.log('osaas accounting: ' + e.message);
  }
  r.return(204);
}

/**
 * stream handler (js_access). Reports go via the localhost http relay (a unix
 * socket) — Debian's njs stream module has no fetch-TLS — and the fetch is
 * deliberately not awaited: the connection proceeds immediately. The explicit
 * Host is required for the socket fetch (see report()).
 */
function stream_record(s) {
  try {
    const id = s.variables.osaas_service_id;
    if (id && ngx.shared.osaas_stream.add(id, '1')) {
      report(s.variables.osaas_relay_url, '', id, 'localhost')
        .then((reply) => {
          if (reply.status !== 204) {
            s.log('osaas accounting: relay returned ' + reply.status + ' for service ' + id);
          }
        })
        .catch((e) => {
          s.log('osaas accounting: ' + e.message);
        });
    }
  } catch (e) {
    s.log('osaas accounting: ' + e.message);
  }
  s.allow();
}

/**
 * http relay for stream-context reports (js_content on the localhost-only
 * relay server). Debian's njs stream module is built without NGX_STREAM_SSL,
 * so stream_record cannot fetch an https manager directly; it POSTs to this
 * relay over plain local http and the http js VM — full fetch-TLS — forwards
 * to the manager. The path shape is validated so the relay can never be used
 * to reach any other manager endpoint with the embedded credential.
 */
async function relay(r) {
  try {
    const m = r.uri.match(/^\/api\/v1\/services\/(\d+)\/last-access$/);
    if (!m) {
      r.return(404);
      return;
    }
    const reply = await report(r.variables.osaas_manager_url, r.variables.osaas_api_key, m[1]);
    r.return(reply.status);
    return;
  } catch (e) {
    r.log('osaas accounting relay: ' + e.message);
  }
  r.return(502);
}

export default { http_record, stream_record, relay };
