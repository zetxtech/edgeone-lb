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

function parseSearchParams(search) {
  try {
    const s = String(search || '').trim();
    if (!s) return new URLSearchParams();
    return new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
  } catch {
    return new URLSearchParams();
  }
}

const PROXY_VERSION = 'ws-proxy-v3';

// Helper to send logs to Edge Functions KV via API
async function remoteLog(message, data = null) {
  try {
    if (!globalThis.LOG_API_URL) return;

    await fetch(globalThis.LOG_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'node-function:ws-proxy',
        message,
        data
      })
    });
  } catch (e) {
    // Fallback to console if remote logging fails
    console.error('Remote logging failed:', e);
  }
}

async function onRequest(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);
    
    // Store API URL for logging helper
    // Construct the log ingest URL based on the current request's origin
    globalThis.LOG_API_URL = `${url.origin}/api/log-ingest`;

    const upgradeHeader = request.headers.get('upgrade');

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

    // Opt-in: let callers ask /__ws_proxy to send a first marker message to client.
    // Useful for testing whether the request actually went through this proxy.
    const originalSearchParams = parseSearchParams(originalSearch);
    const markerEnabled =
      url.searchParams.get('marker') === '1' ||
      originalSearchParams.get('eo_ws_proxy_marker') === '1';

    console.log(`[WS-Proxy] Received WebSocket upgrade request: target=${targetHost}, path=${originalPath}, proto=${originalProto}`);

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

    console.log(`[WS-Proxy] Built upstream URL: ${upstreamUrl}`);
    
    // Log before returning websocket handler (this log may be cut off in serverless)
    await remoteLog('WebSocket upgrade accepted', { 
      target: targetHost, 
      upstreamUrl, 
      originalPath, 
      originalProto 
    });

    // EdgeOne Node Functions websocket handler
    return { websocket: createProxyHandler(upstreamUrl, targetHost, { markerEnabled, originalPath }) };
  } catch (err) {
    const msg = `[WS-Proxy] Internal Error: ${err}`;
    console.error(msg);
    // Try to log even if we are about to crash/return 500
    // Note: remoteLog is async, we don't await it here to avoid delaying the response,
    // but in a serverless environment this might be cut off.
    // However, since we are returning a response, the runtime might keep it alive briefly.
    remoteLog('Internal Error', { error: stringifyError(err) }).catch(() => {});

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

function createProxyHandler(upstreamUrl, targetHost, { markerEnabled = false, originalPath = '' } = {}) {
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

      if (markerEnabled) {
        try {
          safeSend(client, JSON.stringify({
            type: 'eo_ws_proxy_marker',
            ok: true,
            version: PROXY_VERSION,
            ts: Date.now(),
            via: '/__ws_proxy',
            target: targetHost,
            path: originalPath || null,
          }));
        } catch {}
      }

      upstreamCtor = await resolveWebSocketCtor();
      OPEN_STATE = typeof upstreamCtor?.OPEN === 'number' ? upstreamCtor.OPEN : 1;
      isWsLibrary = typeof upstreamCtor?.prototype?.on === 'function';

      if (!upstreamCtor) {
        const msg = `[WS-Proxy] Upstream WebSocket unavailable for ${targetHost}`;
        console.error(msg);
        remoteLog('Upstream WebSocket unavailable', { target: targetHost });
        safeClose(ws, 1011, 'Upstream WebSocket unavailable');
        cleanup();
        return;
      }

      const clientProtocol = request?.headers?.get?.('sec-websocket-protocol') || request?.headers?.get?.('Sec-WebSocket-Protocol') || undefined;

      try {
        const msg = `[WS-Proxy] Connecting to upstream: ${upstreamUrl} (Protocol: ${clientProtocol || 'none'})`;
        console.log(msg);
        remoteLog('Connecting to upstream', { url: upstreamUrl, protocol: clientProtocol });
        
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
        const msg = `[WS-Proxy] Connection setup failed for ${targetHost}: ${e.message}`;
        console.error(msg);
        remoteLog('Connection setup failed', { target: targetHost, error: e.message });
        safeClose(ws, 1011, 'Upstream connect failed');
        cleanup();
        return;
      }

      const flushPending = () => {
        const msg = `[WS-Proxy] Connected to ${targetHost}, flushing ${pending.length} pending messages`;
        console.log(msg);
        remoteLog('Connected to upstream', { target: targetHost, pendingCount: pending.length });
        while (pending.length > 0) {
          const item = pending.shift();
          try {
            upstream.send(item.data);
          } catch (e) {
            console.error(`[WS-Proxy] Failed to flush pending message to ${targetHost}:`, e);
            break;
          }
        }
      };

      const onUpstreamMessage = (data) => {
        if (!safeSend(client, data)) {
          const msg = `[WS-Proxy] Failed to send upstream message to client (client closed?)`;
          console.warn(msg);
          remoteLog('Failed to send to client', { target: targetHost });
          try { upstream.close(); } catch {}
        }
      };

      const onUpstreamClose = (code, reason) => {
        const safeCode = sanitizeCloseCode(code || 1000);
        const reasonStr = reason?.toString?.() || '';
        const msg = `[WS-Proxy] Upstream ${targetHost} closed: ${safeCode} ${reasonStr}`;
        console.log(msg);
        remoteLog('Upstream closed', { target: targetHost, code: safeCode, reason: reasonStr });
        safeClose(client, safeCode, reasonStr);
        cleanup();
      };

      const onUpstreamError = (err) => {
        const msg = `[WS-Proxy] Upstream error for ${targetHost}: ${err}`;
        console.error(msg);
        remoteLog('Upstream error', { target: targetHost, error: String(err) });
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
        upstream.addEventListener('error', (ev) => { onUpstreamError(ev?.error || ev); });
      }
    },

    async onmessage(ws, message, isBinary) {
      let payload = message;
      if (!isBinary && typeof payload !== 'string') {
        payload = payload?.toString?.() ?? String(payload);
      }

      if (!upstream || upstream.readyState !== OPEN_STATE) {
        if (pending.length >= MAX_PENDING) {
          const msg = `[WS-Proxy] Dropping message for ${targetHost}: pending queue full (${MAX_PENDING})`;
          console.warn(msg);
          remoteLog('Dropping message (queue full)', { target: targetHost });
          safeClose(ws, 1013, 'Upstream not ready');
          cleanup();
          return;
        }
        pending.push({ data: payload, isBinary });
        return;
      }

      try {
        upstream.send(payload);
      } catch (e) {
        const msg = `[WS-Proxy] Failed to send message to upstream ${targetHost}: ${e}`;
        console.error(msg);
        remoteLog('Failed to send to upstream', { target: targetHost, error: String(e) });
      }
    },

    async onclose(ws, code, reason) {
      const reasonStr = reason?.toString?.() || '';
      const msg = `[WS-Proxy] Client closed connection: ${code} ${reasonStr}`;
      console.log(msg);
      remoteLog('Client closed connection', { code, reason: reasonStr });
      try {
        upstream?.close?.(sanitizeCloseCode(code), reasonStr);
      } catch {}
      cleanup();
    },

    async onerror(ws, error) {
      const msg = `[WS-Proxy] Client error: ${error}`;
      console.error(msg);
      remoteLog('Client error', { error: String(error) });
      try {
        upstream?.close?.(1011, 'Client error');
      } catch {}
      cleanup();
    }
  };
}

export { onRequest };
export default onRequest;
