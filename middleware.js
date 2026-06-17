import { isAdminHostname, onWebSocketProxyRequest } from './lb-proxy.js';

const INTERNAL_HTTP_PROXY_PREFIX = '/__proxy';

function isInternalProxyPath(pathname) {
  return pathname === INTERNAL_HTTP_PROXY_PREFIX || pathname.startsWith(`${INTERNAL_HTTP_PROXY_PREFIX}/`);
}

export async function middleware(context) {
  const { request, next, rewrite } = context;
  const url = new URL(request.url);
  const upgrade = request.headers.get('upgrade');

  // Diagnostic: prove middleware runs for this request.
  // Check with: lb_kv.get('ws-diag:last-request')
  context.waitUntil?.((async () => {
    try {
      if (typeof lb_kv !== 'undefined') {
        await lb_kv.put('ws-diag:last-request', JSON.stringify({
          time: new Date().toISOString(),
          url: request.url,
          upgrade: upgrade || null,
          pathname: url.pathname,
        }), { expirationTtl: 300 });
      }
    } catch {}
  })());

  if (url.pathname === '/__ws_proxy' || isInternalProxyPath(url.pathname)) {
    return next();
  }

  if (isAdminHostname(url.hostname)) {
    return next();
  }

  if (upgrade?.toLowerCase() === 'websocket') {
    // Diagnostic: write to KV so we can confirm middleware ran.
    // Check with: lb_kv.get('ws-diag:middleware-hit')
    context.waitUntil?.((async () => {
      try {
        if (typeof lb_kv !== 'undefined') {
          await lb_kv.put('ws-diag:middleware-hit', JSON.stringify({
            time: new Date().toISOString(),
            url: request.url,
            upgrade: request.headers.get('upgrade'),
            allHeaders: Object.fromEntries(request.headers.entries()),
          }), { expirationTtl: 300 });
        }
      } catch {}
    })());
    return onWebSocketProxyRequest(context);
  }

  const proxyUrl = new URL(url);
  proxyUrl.pathname = url.pathname === '/'
    ? INTERNAL_HTTP_PROXY_PREFIX
    : `${INTERNAL_HTTP_PROXY_PREFIX}${url.pathname}`;

  return rewrite(proxyUrl.toString());
}

export const config = {
  matcher: '/:path*',
};