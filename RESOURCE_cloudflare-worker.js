// Defensive Cloudflare Worker — robust JSON parsing, clear errors when OPENAI_API_KEY is missing,
// and CORS handling. Deploy this in the Cloudflare dashboard or with wrangler.

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Quick debug endpoint to verify the secret is visible to the running Worker.
    // Call GET /__debug_key to receive { hasKey: true|false } without exposing the key.
    try {
      const url = new URL(request.url);
      if (url.pathname === '/__debug_key') {
        return new Response(JSON.stringify({ hasKey: Boolean(env.OPENAI_API_KEY) }), {
          status: 200,
          headers: corsHeaders
        });
      }

      if (url.pathname === '/__debug_models') {
        const apiKey = env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: { message: 'OPENAI_API_KEY missing; cannot query models.' } }),
            { status: 500, headers: corsHeaders }
          );
        }

        try {
          const modelRes = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`
            }
          });

          const raw = await modelRes.text();
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch (err) {
            data = null;
          }

          const headers = new Headers(corsHeaders);
          const upstreamCT = modelRes.headers.get('content-type');
          if (upstreamCT) headers.set('Content-Type', upstreamCT);

          if (!modelRes.ok) {
            return new Response(
              JSON.stringify({
                error: {
                  message: 'Model list request failed',
                  status: modelRes.status,
                  detail: data ?? raw
                }
              }),
              { status: modelRes.status, headers }
            );
          }

          if (data === null) {
            return new Response(raw, { status: modelRes.status, headers });
          }

          return new Response(JSON.stringify(data), { status: modelRes.status, headers });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: { message: 'Failed to fetch models', details: err.message } }),
            { status: 502, headers: corsHeaders }
          );
        }
      }
    } catch (e) {
      // ignore URL parsing errors and continue
    }

    // Validate secret
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      const missing = {
        error: {
          message:
            'Server misconfiguration: OPENAI_API_KEY is not set in Worker environment. Add the secret in Cloudflare dashboard or via wrangler.',
          type: 'server_error'
        }
      };
      return new Response(JSON.stringify(missing), { status: 500, headers: corsHeaders });
    }

    // Defensive JSON parsing: check headers and content-length before calling request.json()
  let userInput;
    try {
      const contentType = (request.headers.get('content-type') || '').toLowerCase();
      const contentLength = request.headers.get('content-length');

      // If content-length exists and is 0, return 400
      if (contentLength === '0') {
        return new Response(
          JSON.stringify({ error: { message: 'Empty request body' } }),
          { status: 400, headers: corsHeaders }
        );
      }

      // If content-type is present but not JSON, reject
      if (contentType && !contentType.includes('application/json')) {
        return new Response(
          JSON.stringify({ error: { message: 'Content-Type must be application/json' } }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Attempt to parse JSON; await request.json() may throw on empty or invalid JSON
      userInput = await request.json();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid JSON body', details: err.message } }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!userInput || typeof userInput !== 'object') {
      return new Response(
        JSON.stringify({ error: { message: 'Request body must be a JSON object with a messages array.' } }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!Array.isArray(userInput.messages) || userInput.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: { message: 'Request body must include a messages array with at least one item.' } }),
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedMessages = Array.isArray(userInput.messages)
      ? userInput.messages
      : [];

    const model = typeof userInput.model === 'string' && userInput.model.trim().length > 0
      ? userInput.model.trim()
      : 'gpt-4o';

    const requestBody = {
      model,
      messages: normalizedMessages
    };

    console.log('Outgoing OpenAI request body', JSON.stringify(requestBody));

    try {
      const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Read upstream body once as text, then attempt to parse JSON from it.
      const headers = new Headers(corsHeaders);
      const upstreamCT = apiRes.headers.get('content-type');
      if (upstreamCT) headers.set('Content-Type', upstreamCT);

      const raw = await apiRes.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }

      // If upstream returned an error status, return a JSON error with upstream details
      if (!apiRes.ok) {
        const detail = data ?? (raw || apiRes.statusText || 'Empty response body from OpenAI');
        const headerEntries = {};
        for (const [key, value] of apiRes.headers.entries()) {
          headerEntries[key] = value;
        }
        console.error('OpenAI error', apiRes.status, apiRes.statusText || '(no status text)', headerEntries, raw || '(no body returned)');
        return new Response(
          JSON.stringify({ error: { message: 'Upstream API error', status: apiRes.status, detail } }),
          { status: apiRes.status, headers }
        );
      }

      // If upstream returned non-JSON body, forward it as text
      if (data === null) {
        return new Response(raw, { status: apiRes.status, headers });
      }

      if (data === null) {
        return new Response(raw, { status: apiRes.status, headers });
      }

      return new Response(JSON.stringify(data), {
        status: apiRes.status,
        headers
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: 'Proxy error', details: err.message } }), {
        status: 502,
        headers: corsHeaders
      });
    }
  }
};
