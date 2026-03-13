const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { Transform } = require('stream');
const { requireAuth } = require('../middlewares');
const { Setting, SessionSecret } = require('../models');

const router = express.Router();

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_MARGIN_MS = 10 * 60 * 1000; // refresh 10 min before expiry

// --- HMAC token helpers ---

async function getHmacKey() {
  const secret = await SessionSecret.findOne({ order: [['createdAt', 'DESC']] });
  if (!secret) throw new Error('No session secret available for HMAC signing');
  return secret.secret;
}

function generateToken(userId, hmacKey) {
  const payload = `${userId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function validateToken(token, hmacKey) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const lastColon = decoded.lastIndexOf(':');
    const secondLastColon = decoded.lastIndexOf(':', lastColon - 1);
    const userId = decoded.substring(0, secondLastColon);
    const timestamp = parseInt(decoded.substring(secondLastColon + 1, lastColon), 10);
    if (isNaN(timestamp)) return null;
    const hmac = decoded.substring(lastColon + 1);

    const expected = crypto.createHmac('sha256', hmacKey).update(`${userId}:${timestamp}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    if (Date.now() - timestamp > TOKEN_TTL_MS) return null;

    return { userId, timestamp };
  } catch {
    return null;
  }
}

// --- SSE content filter ---
// Strips hallucinated JSON tool-call text from LLM content responses.
// Small models sometimes write tool calls as plain text instead of using
// the function-calling mechanism, e.g. {"name":"set_page_contents",...}.
// This transform buffers content when it looks like JSON is starting,
// then discards the buffer if it matches a tool-call pattern.

function createContentFilter() {
  let jsonBuffer = '';
  let braceDepth = 0;
  let buffering = false;
  // Accumulates text across SSE chunks to detect function-call-style hallucinations
  let textAccumulator = '';

  // Tool names the LLM might hallucinate as text
  const toolNames = ['get_page_contents', 'set_page_contents', 'click_element', 'submit_form'];
  const funcCallPattern = new RegExp(
    '(' + toolNames.join('|') + ')\\s*\\(', 'i'
  );

  return new Transform({
    transform(chunk, encoding, callback) {
      const lines = chunk.toString().split('\n');
      const output = [];

      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') {
          output.push(line);
          continue;
        }

        try {
          const data = JSON.parse(line.substring(6));
          const delta = data.choices?.[0]?.delta;
          const content = delta?.content;

          // Only filter text content (not tool_calls)
          if (typeof content !== 'string' || delta.tool_calls) {
            output.push(line);
            continue;
          }

          // Track text across chunks to detect function-call syntax
          textAccumulator += content;

          // Check for function-call-style hallucinations (e.g. click_element("text"))
          if (funcCallPattern.test(textAccumulator)) {
            // Strip the hallucinated function call from content
            data.choices[0].delta.content = '';
            output.push('data: ' + JSON.stringify(data));
            continue;
          }
          // Keep accumulator trimmed to last 60 chars
          if (textAccumulator.length > 60) {
            textAccumulator = textAccumulator.slice(-60);
          }

          // Process each character for JSON detection
          let filtered = '';
          for (let i = 0; i < content.length; i++) {
            const ch = content[i];
            if (!buffering && ch === '{') {
              buffering = true;
              braceDepth = 1;
              jsonBuffer = ch;
            } else if (buffering) {
              jsonBuffer += ch;
              if (ch === '{') braceDepth++;
              else if (ch === '}') braceDepth--;

              if (braceDepth === 0) {
                // JSON block closed — check if it looks like a tool call
                if (!/["']name["']/.test(jsonBuffer) || jsonBuffer.length < 10) {
                  filtered += jsonBuffer; // Not a tool call, keep it
                }
                jsonBuffer = '';
                buffering = false;
              }
            } else {
              filtered += ch;
            }
          }

          // Rewrite the SSE line with filtered content
          if (filtered !== content) {
            data.choices[0].delta.content = filtered;
            output.push('data: ' + JSON.stringify(data));
          } else {
            output.push(line);
          }
        } catch {
          output.push(line); // Unparseable, forward as-is
        }
      }

      callback(null, output.join('\n'));
    },

    flush(callback) {
      buffering = false;
      jsonBuffer = '';
      braceDepth = 0;
      textAccumulator = '';
      callback();
    }
  });
}

// --- Ozwell settings loader ---

async function getOzwellSettings() {
  const settings = await Setting.getMultiple(['ozwell_api_url', 'ozwell_agent_key']);
  const apiUrl = (settings.ozwell_api_url || '').trim();
  const agentKey = (settings.ozwell_agent_key || '').trim();
  if (!apiUrl || !agentKey) return null;
  return { apiUrl, agentKey };
}

// --- Token endpoint ---

router.get('/token', requireAuth, async (req, res) => {
  try {
    const ozwell = await getOzwellSettings();
    if (!ozwell) return res.status(404).json({ error: 'Chatbot not configured' });

    const hmacKey = await getHmacKey();
    const token = generateToken(req.session.user, hmacKey);

    res.json({
      token,
      ozwellUrl: ozwell.apiUrl,
      tokenTtlMs: TOKEN_TTL_MS,
      refreshMs: TOKEN_TTL_MS - REFRESH_MARGIN_MS
    });
  } catch (err) {
    console.error('Chatbot token generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate chatbot token' });
  }
});

// --- CORS middleware for proxy routes (Ozwell iframe needs cross-origin access) ---

router.use('/v1', async (req, res, next) => {
  try {
    const ozwell = await getOzwellSettings();
    if (!ozwell) return res.status(404).json({ error: 'Chatbot not configured' });

    const origin = new URL(ozwell.apiUrl).origin;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '3600');

    // Store settings for downstream handlers
    req.ozwellSettings = ozwell;
    next();
  } catch (err) {
    console.error('Chatbot CORS middleware error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle CORS preflight
router.options('/v1/{*path}', (req, res) => res.sendStatus(204));

// --- Proxy middleware: validate token + forward to Ozwell ---

router.all('/v1/{*path}', async (req, res) => {
  try {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const hmacKey = await getHmacKey();
    const tokenData = validateToken(authHeader.substring(7), hmacKey);
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid or expired chatbot token' });
    }

    const { apiUrl, agentKey } = req.ozwellSettings;
    // path-to-regexp 8.x returns wildcard as an array of segments
    const pathSegments = req.params.path || [];
    const subPath = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments;
    const targetUrl = `${apiUrl}/v1/${subPath}`;

    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      params: req.query,
      headers: {
        'Authorization': `Bearer ${agentKey}`,
        'Content-Type': req.get('Content-Type') || 'application/json',
      },
      // Stream the response for SSE support
      responseType: 'stream',
      // Don't throw on non-2xx so we can forward error responses
      validateStatus: () => true,
    };

    // Forward request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      axiosConfig.data = req.body;
      // Re-serialize body since express.json() already parsed it
      if (req.is('application/json')) {
        axiosConfig.data = JSON.stringify(req.body);
        axiosConfig.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await axios(axiosConfig);

    // Forward status and relevant headers
    res.status(response.status);
    const forwardHeaders = ['content-type', 'cache-control', 'x-request-id'];
    for (const header of forwardHeaders) {
      if (response.headers[header]) {
        res.setHeader(header, response.headers[header]);
      }
    }

    // Pipe the response stream through content filter for SSE, or directly for other responses
    const isSSE = (response.headers['content-type'] || '').includes('text/event-stream');
    if (isSSE) {
      response.data.pipe(createContentFilter()).pipe(res);
    } else {
      response.data.pipe(res);
    }
  } catch (err) {
    console.error('Chatbot proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to reach chatbot service' });
    }
  }
});

module.exports = router;
