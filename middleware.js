import { isAdminHostname, onWebSocketProxyRequest } from './lb-proxy.js';

const INTERNAL_HTTP_PROXY_PREFIX = '/__proxy';

function isInternalProxyPath(pathname) {
  return pathname === INTERNAL_HTTP_PROXY_PREFIX || pathname.startsWith(`${INTERNAL_HTTP_PROXY_PREFIX}/`);
}

export async function middleware(context) {
  const { request, next, rewrite } = context;
  const url = new URL(request.url);
  const upgrade = request.headers.get('upgrade');

  if (url.pathname === '/__ws_proxy' || isInternalProxyPath(url.pathname)) {
    return next();
  }

  if (isAdminHostname(url.hostname)) {
    return next();
  }

  if (upgrade?.toLowerCase() === 'websocket') {
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