// EdgeOne Pages Edge Function - Load Balancer
// Handles all proxied domain requests, reads rules from KV and forwards to backend

// KV binding name (must be configured in EdgeOne Pages console)
// lb_kv is injected by EdgeOne Pages runtime

export async function onRequest({ request, params, env }) {
  try {
    // Get original path from params (e.g., ['user', '1'] for /user/1)
    const pathSegments = params.path || [];
    const originalPath = '/' + pathSegments.join('/');
    
    // Get original query string
    const url = new URL(request.url);
    const queryString = url.search;
    
    // Get the original hostname from request headers
    const hostname = request.headers.get('host')?.split(':')[0];
    
    if (!hostname) {
      return new Response(JSON.stringify({ error: 'Missing host header' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get rules from KV
    let rules = {};
    try {
      rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    } catch (error) {
      console.error('Failed to read KV:', error);
      return new Response(JSON.stringify({ error: 'KV storage not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if we have rules for this hostname
    const rule = rules[hostname];
    if (!rule) {
      return new Response(JSON.stringify({ error: `Domain ${hostname} not configured` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get available targets
    const targets = rule.targets || [];
    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: 'No backend targets configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Select target using simple round-robin based on timestamp
    const targetIndex = Date.now() % targets.length;
    const target = targets[targetIndex];

    // Build backend URL
    const protocol = target.type === 'https' ? 'https' : 'http';
    const port = target.port ? `:${target.port}` : '';
    const backendUrl = `${protocol}://${target.host}${port}${originalPath}${queryString}`;

    // Build proxy headers
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set('X-Forwarded-Host', hostname);
    proxyHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    proxyHeaders.set('X-Real-IP', request.headers.get('cf-connecting-ip') || 
                                  request.headers.get('x-forwarded-for')?.split(',')[0] || 
                                  'unknown');

    // Create proxy request
    const proxyRequest = new Request(backendUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'manual'
    });

    // Fetch from backend
    const response = await fetch(proxyRequest, {
      eo: {
        timeoutSetting: {
          connectTimeout: 10000,
          readTimeout: 30000,
          writeTimeout: 30000
        }
      }
    });

    // Build response with custom headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-LB-Backend', target.host);
    responseHeaders.set('X-LB-Powered-By', 'EdgeOne-LB');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });

  } catch (error) {
    console.error('Load balancer error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
