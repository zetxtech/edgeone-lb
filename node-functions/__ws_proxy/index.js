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
  // Prefer 'ws' library — it supports custom headers (Origin, etc.)
  // which are critical for upstream servers that validate Origin.
  try {
    const mod = await import('ws');
    const ctor = mod?.default || mod?.WebSocket || mod;
    if (ctor) return ctor;
  } catch {}
  // Fallback to global WebSocket (may not support custom headers)
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  return null;
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

function sanitizeUpstreamWebSocketHeaders(headers) {
  const sanitized = new Headers(headers || undefined);
  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ];
  const platformHeaders = [
    'cdn-loop',
    'eo-pages-dataset',
    'eo-pages-language',
    'x-nws-log-uuid',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
  ];
  const wsManagedHeaders = [
    'content-length',
    'host',
    'origin',
    'sec-websocket-extensions',
    'sec-websocket-key',
    'sec-websocket-protocol',
    'sec-websocket-version',
  ];

  for (const header of hopByHopHeaders) {
    sanitized.delete(header);
  }

  for (const header of platformHeaders) {
    sanitized.delete(header);
  }

  for (const header of wsManagedHeaders) {
    sanitized.delete(header);
  }

  return sanitized;
}

const PROXY_VERSION = 'ws-proxy-v3';

function log(...args) {
  try { console.log('[ws-proxy]', new Date().toISOString(), ...args); } catch {}
}

async function onRequest(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);

    const upgradeHeader = request.headers.get('upgrade');
    log('onRequest called', { url: request.url, upgrade: upgradeHeader, method: request.method });

    const diag = url.searchParams.get('diag') === '1';

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      log('No websocket upgrade header, upgrade=', upgradeHeader);
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

    log('Building upstream URL', { targetHost, originalPath, originalSearch, originalProto });

    const upstreamUrl = buildUpstreamWsUrl(targetHost, request.url, originalPath, originalSearch, originalProto);
    log('Upstream URL built', upstreamUrl);

    return { websocket: createProxyHandler(upstreamUrl, targetHost) };
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

function createProxyHandler(upstreamUrl, targetHost) {
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
    log('cleanup called');
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
      try {
      log('onopen called, upstreamUrl=', upstreamUrl);
      client = ws;

      try {
        upstreamCtor = await resolveWebSocketCtor();
      } catch (ctorErr) {
        log('resolveWebSocketCtor threw', stringifyError(ctorErr));
        safeClose(ws, 1011, 'WS ctor error');
        cleanup();
        return;
      }
      OPEN_STATE = typeof upstreamCtor?.OPEN === 'number' ? upstreamCtor.OPEN : 1;
      isWsLibrary = typeof upstreamCtor?.prototype?.on === 'function';
      log('WS ctor resolved', { available: !!upstreamCtor, isWsLibrary, OPEN_STATE });

      if (!upstreamCtor) {
        log('No upstream WebSocket constructor available');
        safeClose(ws, 1011, 'Upstream WebSocket unavailable');
        cleanup();
        return;
      }

      const clientProtocol = request?.headers?.get?.('sec-websocket-protocol') || request?.headers?.get?.('Sec-WebSocket-Protocol') || undefined;
      const clientOrigin = request?.headers?.get?.('origin') || request?.headers?.get?.('Origin') || undefined;
      const forwardedHeaders = sanitizeUpstreamWebSocketHeaders(request?.headers);
      const forwardedHeaderObject = Object.fromEntries(forwardedHeaders.entries());

      try {
        log('Creating upstream WS', { upstreamUrl, isWsLibrary, clientProtocol: clientProtocol || null, origin: clientOrigin || null });
        if (isWsLibrary) {
          const options = {
            handshakeTimeout: 10000,
            perMessageDeflate: false,
          };

          if (clientOrigin) {
            options.origin = clientOrigin;
            // Also set in headers for maximum compatibility
            forwardedHeaderObject['Origin'] = clientOrigin;
          }

          if (Object.keys(forwardedHeaderObject).length > 0) {
            options.headers = forwardedHeaderObject;
          }

          log('ws lib options', { origin: options.origin || null, headerKeys: Object.keys(options.headers || {}) });
          upstream = clientProtocol
            ? new upstreamCtor(upstreamUrl, clientProtocol, options)
            : new upstreamCtor(upstreamUrl, options);
        } else {
          upstream = clientProtocol
            ? new upstreamCtor(upstreamUrl, clientProtocol)
            : new upstreamCtor(upstreamUrl);
        }
        log('Upstream WS created, readyState=', upstream?.readyState);
      } catch (connErr) {
        log('Upstream WS creation failed', stringifyError(connErr));
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
        log('Upstream WS closed', { code, reason: reason?.toString?.() });
        const safeCode = sanitizeCloseCode(code || 1000);
        const reasonStr = reason?.toString?.() || '';
        safeClose(client, safeCode, reasonStr);
        cleanup();
      };

      const onUpstreamError = (err) => {
        log('Upstream WS error', stringifyError(err));
        safeClose(client, 1011, 'Upstream error');
        cleanup();
      };

      if (isWsLibrary) {
        log('Registering ws lib event handlers');
        upstream.on('open', () => { log('Upstream WS open event'); flushPending(); });
        upstream.on('message', onUpstreamMessage);
        upstream.on('close', onUpstreamClose);
        upstream.on('error', onUpstreamError);
      } else {
        log('Registering native WS event handlers');
        upstream.addEventListener('open', () => { log('Upstream WS open event'); flushPending(); });
        upstream.addEventListener('message', (ev) => { onUpstreamMessage(ev?.data); });
        upstream.addEventListener('close', (ev) => { onUpstreamClose(ev?.code, ev?.reason); });
        upstream.addEventListener('error', (ev) => { onUpstreamError(ev?.error || ev); });
      }
      log('Upstream WS handlers registered, waiting for open...');
      } catch (onopenErr) {
        log('onopen unhandled error', stringifyError(onopenErr));
        safeClose(ws, 1011, 'Proxy internal error');
        cleanup();
      }
    },

    async onmessage(ws, message, isBinary) {
      log('Client message', { len: message?.length ?? message?.byteLength, isBinary });
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
      log('Client WS closed', { code, reason: reason?.toString?.() });
      const reasonStr = reason?.toString?.() || '';
      try {
        upstream?.close?.(sanitizeCloseCode(code), reasonStr);
      } catch {}
      cleanup();
    },

    async onerror(err) {
      log('Client WS error', stringifyError(err));
      try {
        upstream?.close?.(1011, 'Client error');
      } catch {}
      cleanup();
    }
  };
}

export { onRequest };
export default onRequest;
