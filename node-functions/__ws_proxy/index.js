/**
 * Node Functions WebSocket proxy handler.
 *
 * Middleware rewrites WebSocket upgrade requests to /__ws_proxy.
 * This handler terminates the client WebSocket and opens a new upstream WebSocket,
 * then proxies frames in both directions.
 *
 * Query params:
 * - host: original hostname (rule key)
 * - path: original pathname
 * - search: original search string (including leading '?', optional)
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getKv(env) {
  return env?.lb_kv || globalThis.lb_kv;
}

function getWebSocketCtor() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    // ws CJS export is the WebSocket constructor.
    return require('ws');
  } catch {
    return null;
  }
}

const DEBUG_LOG_KEY = 'debug:logs';
const DEBUG_FLAG_KEY = 'config:debug';
const MAX_LOG_ENTRIES = 200;

async function debugLog(env, message, data = null) {
  try {
    const kv = getKv(env);
    if (!kv) return;
    const enabled = await kv.get(DEBUG_FLAG_KEY);
    if (enabled !== 'true') return;

    const entry = {
      timestamp: new Date().toISOString(),
      message,
      data: data ? JSON.stringify(data) : null,
    };

    let logs = [];
    try {
      const existing = await kv.get(DEBUG_LOG_KEY, { type: 'json' });
      if (Array.isArray(existing)) logs = existing;
    } catch {}

    logs.unshift(entry);
    if (logs.length > MAX_LOG_ENTRIES) logs = logs.slice(0, MAX_LOG_ENTRIES);

    await kv.put(DEBUG_LOG_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

async function getRules(env) {
  const kv = getKv(env);
  if (!kv) return null;
  return (await kv.get('rules', { type: 'json' })) || {};
}

async function getHealth(env, host) {
  const kv = getKv(env);
  if (!kv) return null;
  try {
    return await kv.get(`health:${host}`, { type: 'json' });
  } catch {
    return null;
  }
}

async function pickTarget(env, targets) {
  if (!Array.isArray(targets) || targets.length === 0) return null;

  const withStats = await Promise.all(
    targets.map(async (t) => {
      const h = await getHealth(env, t.host);
      return {
        target: t,
        status: h?.status || 'unknown',
        latency: typeof h?.latency === 'number' ? h.latency : 9999,
      };
    })
  );

  const score = (s) => (s === 'healthy' ? 0 : s === 'unknown' ? 1 : 2);
  withStats.sort((a, b) => {
    if (score(a.status) !== score(b.status)) return score(a.status) - score(b.status);
    return a.latency - b.latency;
  });

  return withStats[0]?.target || targets[0];
}

function buildUpstreamWsUrl(targetHost, originalUrl, originalPath, originalSearch) {
  const base = new URL(originalUrl);
  const parts = String(targetHost).split(':');
  base.hostname = parts[0];
  if (parts[1]) base.port = parts[1];
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

  // Always restore the original request path/search so upstream does not see proxy query params.
  base.pathname = originalPath || '/';
  if (originalSearch) {
    // originalSearch may include leading '?'
    base.search = originalSearch.startsWith('?') ? originalSearch : `?${originalSearch}`;
  } else {
    base.search = '';
  }

  return base.toString();
}

export const onRequest = async (context) => {
  const { request, env } = context;
  const upgradeHeader = request.headers.get('upgrade');
  const url = new URL(request.url);

  const WebSocketCtor = getWebSocketCtor();
  if (!WebSocketCtor) {
    await debugLog(env, 'WS-Proxy: WebSocket ctor unavailable');
    return new Response('WebSocket runtime unavailable', { status: 500 });
  }

  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', {
      status: 426,
      headers: {
        'Content-Type': 'text/plain',
        'Upgrade': 'websocket'
      }
    });
  }

  const originalHost = url.searchParams.get('host') || '';
  const originalPath = url.searchParams.get('path') || '';
  const originalSearch = url.searchParams.get('search') || '';

  await debugLog(env, 'WS-Proxy: upgrade request', {
    originalHost,
    originalPath,
    originalSearch,
    url: request.url,
  });

  const rules = await getRules(env);
  const rule = rules?.[originalHost];
  const targets = rule?.targets || [];

  if (!rule || !Array.isArray(targets) || targets.length === 0) {
    await debugLog(env, 'WS-Proxy: no rule/targets', { originalHost });
    return new Response('No backend configured', { status: 502 });
  }

  const target = await pickTarget(env, targets);
  if (!target) {
    await debugLog(env, 'WS-Proxy: no target pickable', { originalHost });
    return new Response('No backend available', { status: 503 });
  }

  const upstreamUrl = buildUpstreamWsUrl(target.host, request.url, originalPath, originalSearch);

  await debugLog(env, 'WS-Proxy: selected upstream', {
    target: target.host,
    type: target.type,
    upstreamUrl,
  });

  // EdgeOne Node Functions websocket handler
  return {
    websocket: createProxyHandler(WebSocketCtor, upstreamUrl, env)
  };
};

function createProxyHandler(WebSocketCtor, upstreamUrl, env) {
  let upstream = null;
  let client = null;
  let clientClosed = false;
  const pending = [];
  const MAX_PENDING = 256;

  const OPEN_STATE = typeof WebSocketCtor?.OPEN === 'number' ? WebSocketCtor.OPEN : 1;
  const isWsLibrary = typeof WebSocketCtor?.prototype?.on === 'function';

  const safeClose = (ws, code, reason) => {
    try {
      ws?.close?.(code, reason);
    } catch {}
  };

  const sanitizeCloseCode = (code) => {
    if (typeof code !== 'number' || !Number.isFinite(code)) return 1000;
    // Invalid/Reserved close codes that must not be sent on the wire.
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
      await debugLog(env, 'WS-Proxy: client open');

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
            ? new WebSocketCtor(upstreamUrl, clientProtocol, options)
            : new WebSocketCtor(upstreamUrl, options);
        } else {
          upstream = clientProtocol
            ? new WebSocketCtor(upstreamUrl, clientProtocol)
            : new WebSocketCtor(upstreamUrl);
        }
      } catch (e) {
        await debugLog(env, 'WS-Proxy: upstream ctor failed', { error: e.message });
        safeClose(ws, 1011, 'Upstream connect failed');
        cleanup();
        return;
      }

      const flushPending = async () => {
        await debugLog(env, 'WS-Proxy: upstream open');

        if (pending.length > 0) {
          await debugLog(env, 'WS-Proxy: flushing buffered messages', { count: pending.length });
        }
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
          debugLog(env, 'WS-Proxy: send to client failed');
          try { upstream.close(); } catch {}
        }
      };

      const onUpstreamClose = async (code, reason) => {
        await debugLog(env, 'WS-Proxy: upstream close', { code, reason: reason?.toString?.() });
        safeClose(client, sanitizeCloseCode(code || 1000), reason?.toString?.() || '');
        cleanup();
      };

      const onUpstreamError = async (err) => {
        await debugLog(env, 'WS-Proxy: upstream error', { error: err?.message || String(err) });
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
          await debugLog(env, 'WS-Proxy: pending overflow; closing', { max: MAX_PENDING });
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
        await debugLog(env, 'WS-Proxy: send to upstream failed', { error: e.message });
      }
    },

    async onclose(ws, code, reason) {
      await debugLog(env, 'WS-Proxy: client close', { code, reason: reason?.toString?.() });
      try {
        upstream?.close?.(sanitizeCloseCode(code), reason?.toString?.());
      } catch {}
      cleanup();
    },

    async onerror(ws, error) {
      await debugLog(env, 'WS-Proxy: client error', { error: error?.message || String(error) });
      try {
        upstream?.close?.(1011, 'Client error');
      } catch {}
      cleanup();
    }
  };
}
