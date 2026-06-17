import { isAdminHostname } from './lb-proxy.js';

const INTERNAL_HTTP_PROXY_PREFIX = '/__proxy';

function isInternalProxyPath(pathname) {
  return pathname === INTERNAL_HTTP_PROXY_PREFIX || pathname.startsWith(`${INTERNAL_HTTP_PROXY_PREFIX}/`);
}

export async function middleware(context) {
  const { request, next, rewrite } = context;
  const url = new URL(request.url);

  // WebSocket proxy endpoint — pass through to Node Function.
  if (url.pathname === '/__ws_proxy' || url.pathname.startsWith('/__ws_proxy/')) {
    return next();
  }

  if (isInternalProxyPath(url.pathname)) {
    return next();
  }

  if (isAdminHostname(url.hostname)) {
    return next();
  }

  // HTTP proxy — rewrite to internal edge-function path.
  // (WebSocket upgrades bypass middleware entirely; the platform routes
  //  them directly to the catch-all Node Function.)
  const proxyUrl = new URL(url);
  proxyUrl.pathname = url.pathname === '/'
    ? INTERNAL_HTTP_PROXY_PREFIX
    : `${INTERNAL_HTTP_PROXY_PREFIX}${url.pathname}`;

  return rewrite(proxyUrl.toString());
}

export const config = {
  matcher: '/:path*',
};