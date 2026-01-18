/**
 * Export API - Generate standalone Edge Function code with embedded rules
 * GET /api/export
 */

export async function onRequest({ request }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ 
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rulesData = await lb_kv.get('rules', { type: 'json' }) || {}

    const code = `/**
 * EdgeOne Load Balancer - Standalone Edge Function
 * Generated at: ${new Date().toISOString()}
 * 
 * Deploy this file to EdgeOne Edge Functions for load balancing without admin panel.
 */

const RULES = ${JSON.stringify(rulesData, null, 2)};

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const hostname = url.hostname;
  
  const rule = RULES[hostname];
  if (!rule || !rule.targets || rule.targets.length === 0) {
    return new Response('No backend configured for this domain', { status: 502 });
  }

  // Force HTTPS redirect
  if (rule.forceHttps && url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  // Simple round-robin selection (random for stateless)
  const target = rule.targets[Math.floor(Math.random() * rule.targets.length)];
  
  // Build backend URL
  const [host, port] = target.host.includes(':') 
    ? target.host.split(':') 
    : [target.host, '443'];
  
  const backendUrl = new URL(request.url);
  backendUrl.hostname = host;
  backendUrl.port = port;
  backendUrl.protocol = 'https:';

  // Forward request to backend
  const backendRequest = new Request(backendUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual'
  });

  // Set original host header for backends that need it
  backendRequest.headers.set('X-Forwarded-Host', hostname);
  backendRequest.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  try {
    return await fetch(backendRequest);
  } catch (error) {
    return new Response('Backend unavailable: ' + error.message, { status: 502 });
  }
}
`

    return new Response(code, {
      headers: {
        'Content-Type': 'application/javascript',
        'Content-Disposition': 'attachment; filename="edgeone-function.js"'
      }
    })
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to export',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
