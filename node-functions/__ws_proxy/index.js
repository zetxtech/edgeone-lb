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

function getKv(env) {
  // Prefer explicit env binding if available.
  if (env?.lb_kv) return env.lb_kv;

  // Some EdgeOne runtimes inject KV bindings as global identifiers (not on globalThis).
  try {
    // eslint-disable-next-line no-undef
    if (typeof lb_kv !== 'undefined') return lb_kv;
  } catch {
    // ignore
  }

  // Fallback: if it happens to be attached to globalThis.
  if (globalThis?.lb_kv) return globalThis.lb_kv;

  return null;
}

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

function buildUpstreamWsUrlWithProto(targetHost, originalUrl, originalPath, originalSearch, originalProto) {
  const base = new URL(originalUrl);
  const parts = String(targetHost).split(':');
  base.hostname = parts[0];
  if (parts[1]) base.port = parts[1];

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

const PROXY_VERSION = 'ws-proxy-v2';

async function onRequest(context) {
  const { request, env } = context;
  try {
    const upgradeHeader = request.headers.get('upgrade');
    const url = new URL(request.url);
    const diag = url.searchParams.get('diag') === '1';

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      if (diag) {
        const kv = getKv(env);
        let debugEnabled = null;
        try {
          debugEnabled = kv ? await kv.get(DEBUG_FLAG_KEY) : null;
        } catch {
          debugEnabled = 'error';
        }

        const wsCtor = await resolveWebSocketCtor();
        const wsInfo = {
          available: !!wsCtor,
          name: wsCtor?.name || null,
          isWsLibrary: typeof wsCtor?.prototype?.on === 'function',
        };

        return new Response(JSON.stringify({
          ok: true,
          version: PROXY_VERSION,
          note: 'This endpoint expects an HTTP GET with Upgrade: websocket',
          url: request.url,
          upgrade: upgradeHeader || null,
          kvAvailable: !!kv,
          debugEnabled,
          ws: wsInfo,
          envAvailable: !!env,
          envKeysCount: env ? Object.keys(env).length : 0,
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

    const originalHost = (url.searchParams.get('host') || '').trim();
    const originalPath = (url.searchParams.get('path') || '').trim();
    const originalSearch = (url.searchParams.get('search') || '').trim();
    const originalProto = (url.searchParams.get('proto') || '').trim();

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

    const upstreamUrl = buildUpstreamWsUrlWithProto(target.host, request.url, originalPath, originalSearch, originalProto);

  await debugLog(env, 'WS-Proxy: selected upstream', {
    target: target.host,
    type: target.type,
    upstreamUrl,
  });

    // EdgeOne Node Functions websocket handler
    // Note: we intentionally do NOT fail the handshake even if upstream client WebSocket ctor is unavailable.
    // We'll accept the client connection first and then close it with a proper WS close code if needed.
    return { websocket: createProxyHandler(upstreamUrl, env) };
  } catch (err) {
    await debugLog(context?.env, 'WS-Proxy: onRequest crash', { error: stringifyError(err) });

    // If the request is not a WS upgrade, allow reading diagnostics in browser.
    // For WS upgrade failures, most clients won't show body; use diag=1 non-WS request for inspection.
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

export { onRequest };
export default onRequest;

function createProxyHandler(upstreamUrl, env) {
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

      upstreamCtor = await resolveWebSocketCtor();
      OPEN_STATE = typeof upstreamCtor?.OPEN === 'number' ? upstreamCtor.OPEN : 1;
      isWsLibrary = typeof upstreamCtor?.prototype?.on === 'function';

      if (!upstreamCtor) {
        await debugLog(env, 'WS-Proxy: upstream WebSocket ctor unavailable');
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
