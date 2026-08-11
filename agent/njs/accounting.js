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
 *   $osaas_manager_url  manager base URL, no trailing slash
 *   $osaas_api_key      admin API key; empty for the manager's own agent,
 *                       which reports over localhost without credentials
 */

function report(managerUrl, apiKey, serviceId) {
  const headers = {};
  if (apiKey) {
    headers.Authorization = 'Bearer ' + apiKey;
  }
  return ngx.fetch(managerUrl + '/api/v1/services/' + serviceId + '/last-access', {
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
 * stream handler (js_access). The fetch is deliberately not awaited: the
 * connection proceeds immediately and the report completes in the
 * background while the session lives.
 */
function stream_record(s) {
  try {
    const id = s.variables.osaas_service_id;
    if (id && ngx.shared.osaas_stream.add(id, '1')) {
      report(s.variables.osaas_manager_url, s.variables.osaas_api_key, id)
        .then((reply) => {
          if (reply.status !== 204) {
            s.log('osaas accounting: manager returned ' + reply.status + ' for service ' + id);
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

export default { http_record, stream_record };
