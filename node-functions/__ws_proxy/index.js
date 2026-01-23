/**
 * Node Functions WebSocket proxy handler.
 *
 * Middleware rewrites WebSocket upgrade requests to /__ws_proxy.
 * This handler terminates the client WebSocket and opens a new upstream WebSocket,
 * then proxies frames in both directions.
 *
 * Query params (passed by middleware, no KV needed):
 * - target: upstream host (e.g., "backend.example.com" or "backend.example.com:8080")
 * - path: original pathname
 * - search: original search string (including leading '?', optional)
 * - proto: original protocol hint (https/http/wss/ws)
 */

async function resolveWebSocketCtor() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    // 'ws' is CommonJS; dynamic import returns { default: CJSExport }
    const mod = await import('ws');
    return mod?.default || mod?.WebSocket || mod;
  } catch {
    return null;
  }
}

function stringifyError(err) {
  try {
    if (!err) return null;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } catch {
    return { message: String(err) };
  }
}

function buildUpstreamWsUrl(targetHost, originalUrl, originalPath, originalSearch, originalProto) {
  const base = new URL(originalUrl);
  const parts = String(targetHost).split(':');
  base.hostname = parts[0];
  if (parts[1]) base.port = parts[1];
  else base.port = '';

  const proto = String(originalProto || '').toLowerCase();
  if (proto === 'https' || proto === 'wss') {
    base.protocol = 'wss:';
  } else if (proto === 'http' || proto === 'ws') {
    base.protocol = 'ws:';
  } else {
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  }

  base.pathname = originalPath || '/';
  if (originalSearch) {
    base.search = originalSearch.startsWith('?') ? originalSearch : `?${originalSearch}`;
  } else {
    base.search = '';
  }

  return base.toString();
}

const PROXY_VERSION = 'ws-proxy-v3';

async function onRequest(context) {
  const { request } = context;
  try {
    const upgradeHeader = request.headers.get('upgrade');
    const url = new URL(request.url);
    const diag = url.searchParams.get('diag') === '1';

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      if (diag) {
        const wsCtor = await resolveWebSocketCtor();
        const wsInfo = {
          available: !!wsCtor,
          name: wsCtor?.name || null,
          isWsLibrary: typeof wsCtor?.prototype?.on === 'function',
        };

        return new Response(JSON.stringify({
          ok: true,
          version: PROXY_VERSION,
          note: 'This endpoint expects an HTTP GET with Upgrade: websocket. Target is passed via query params by middleware.',
          url: request.url,
          upgrade: upgradeHeader || null,
          ws: wsInfo,
          params: {
            target: url.searchParams.get('target') || null,
            path: url.searchParams.get('path') || null,
            search: url.searchParams.get('search') || null,
            proto: url.searchParams.get('proto') || null,
          },
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      return new Response('Expected Upgrade: websocket', {
        status: 426,
        headers: {
          'Content-Type': 'text/plain',
          'Upgrade': 'websocket'
        }
      });
    }

    const targetHost = (url.searchParams.get('target') || '').trim();
    const originalPath = (url.searchParams.get('path') || '').trim();
    const originalSearch = (url.searchParams.get('search') || '').trim();
    const originalProto = (url.searchParams.get('proto') || '').trim();

    if (!targetHost) {
      return new Response(JSON.stringify({
        error: 'Missing target parameter',
        version: PROXY_VERSION,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const upstreamUrl = buildUpstreamWsUrl(targetHost, request.url, originalPath, originalSearch, originalProto);

    // EdgeOne Node Functions websocket handler
    return { websocket: createProxyHandler(upstreamUrl) };
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Internal Error',
      version: PROXY_VERSION,
      detail: stringifyError(err),
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

function createProxyHandler(upstreamUrl) {
  let upstream = null;
  let client = null;
  let clientClosed = false;
  const pending = [];
  const MAX_PENDING = 256;

  let upstreamCtor = null;
  let OPEN_STATE = 1;
  let isWsLibrary = false;

  const safeClose = (ws, code, reason) => {
    try {
      ws?.close?.(code, reason);
    } catch {}
  };

  const sanitizeCloseCode = (code) => {
    if (typeof code !== 'number' || !Number.isFinite(code)) return 1000;
    if (code === 1005 || code === 1006 || code === 1015) return 1000;
    if (code < 1000 || code > 4999) return 1000;
    return code;
  };

  const safeSend = (ws, data) => {
    try {
      ws?.send?.(data);
      return true;
    } catch {
      return false;
    }
  };

  const cleanup = () => {
    if (clientClosed) return;
    clientClosed = true;
    pending.length = 0;
    try {
      upstream?.terminate?.();
    } catch {}
    try {
      upstream?.close?.();
    } catch {}
    upstream = null;
  };

  return {
    async onopen(ws, request) {
      client = ws;

      upstreamCtor = await resolveWebSocketCtor();
      OPEN_STATE = typeof upstreamCtor?.OPEN === 'number' ? upstreamCtor.OPEN : 1;
      isWsLibrary = typeof upstreamCtor?.prototype?.on === 'function';

      if (!upstreamCtor) {
        safeClose(ws, 1011, 'Upstream WebSocket unavailable');
        cleanup();
        return;
      }

      const clientProtocol = request?.headers?.get?.('sec-websocket-protocol') || request?.headers?.get?.('Sec-WebSocket-Protocol') || undefined;

      try {
        if (isWsLibrary) {
          const options = {
            handshakeTimeout: 10000,
            perMessageDeflate: false,
            headers: {
              'User-Agent': 'EdgeOne-LB-WS-Proxy'
            }
          };

          upstream = clientProtocol
            ? new upstreamCtor(upstreamUrl, clientProtocol, options)
            : new upstreamCtor(upstreamUrl, options);
        } else {
          upstream = clientProtocol
            ? new upstreamCtor(upstreamUrl, clientProtocol)
            : new upstreamCtor(upstreamUrl);
        }
      } catch (e) {
        safeClose(ws, 1011, 'Upstream connect failed');
        cleanup();
        return;
      }

      const flushPending = () => {
        while (pending.length > 0) {
          const item = pending.shift();
          try {
            upstream.send(item.data);
          } catch {
            break;
          }
        }
      };

      const onUpstreamMessage = (data) => {
        if (!safeSend(client, data)) {
          try { upstream.close(); } catch {}
        }
      };

      const onUpstreamClose = (code, reason) => {
        safeClose(client, sanitizeCloseCode(code || 1000), reason?.toString?.() || '');
        cleanup();
      };

      const onUpstreamError = () => {
        safeClose(client, 1011, 'Upstream error');
        cleanup();
      };

      if (isWsLibrary) {
        upstream.on('open', flushPending);
        upstream.on('message', onUpstreamMessage);
        upstream.on('close', onUpstreamClose);
        upstream.on('error', onUpstreamError);
      } else {
        upstream.addEventListener('open', () => { flushPending(); });
        upstream.addEventListener('message', (ev) => { onUpstreamMessage(ev?.data); });
        upstream.addEventListener('close', (ev) => { onUpstreamClose(ev?.code, ev?.reason); });
        upstream.addEventListener('error', () => { onUpstreamError(); });
      }
    },

    async onmessage(ws, message, isBinary) {
      let payload = message;
      if (!isBinary && typeof payload !== 'string') {
        payload = payload?.toString?.() ?? String(payload);
      }

      if (!upstream || upstream.readyState !== OPEN_STATE) {
        if (pending.length >= MAX_PENDING) {
          safeClose(ws, 1013, 'Upstream not ready');
          cleanup();
          return;
        }
        pending.push({ data: payload, isBinary });
        return;
      }

      try {
        upstream.send(payload);
      } catch {}
    },

    async onclose(ws, code, reason) {
      try {
        upstream?.close?.(sanitizeCloseCode(code), reason?.toString?.());
      } catch {}
      cleanup();
    },

    async onerror(ws, error) {
      try {
        upstream?.close?.(1011, 'Client error');
      } catch {}
      cleanup();
    }
  };
}

export { onRequest };
export default onRequest;
