/**
 * Node Functions WebSocket echo backend.
 *
 * This endpoint is useful as a stable upstream for testing:
 * - Direct: connect to /__ws_backend on the admin hostname
 * - Via middleware: connect to /__ws_backend on a proxied hostname (middleware rewrites to /__ws_proxy)
 */

function parseIntParam(url, key, fallback, { min, max } = {}) {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  let v = n;
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

function safeSend(ws, data) {
  try {
    ws?.send?.(data);
    return true;
  } catch {
    return false;
  }
}

function safeClose(ws, code, reason) {
  try {
    ws?.close?.(code, reason);
  } catch {}
}

function sanitizeCloseCode(code) {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 1000;
  if (code === 1005 || code === 1006 || code === 1015) return 1000;
  if (code < 1000 || code > 4999) return 1000;
  return code;
}

const BACKEND_VERSION = 'ws-backend-v1';

async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const upgradeHeader = request.headers.get('upgrade');

  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    const diag = url.searchParams.get('diag') === '1';
    if (diag) {
      return new Response(JSON.stringify({
        ok: true,
        version: BACKEND_VERSION,
        note: 'This endpoint expects Upgrade: websocket. Use it as an upstream for /__ws_proxy.',
        url: request.url,
        upgrade: upgradeHeader || null,
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return new Response('Expected Upgrade: websocket', {
      status: 426,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Upgrade': 'websocket',
      },
    });
  }

  const intervalMs = parseIntParam(url, 'intervalMs', 0, { min: 0, max: 60_000 });
  const count = parseIntParam(url, 'count', 0, { min: 0, max: 10_000 });

  return {
    websocket: createEchoHandler({ intervalMs, count, requestUrl: request.url }),
  };
}

function createEchoHandler({ intervalMs, count, requestUrl }) {
  let timer = null;
  let ticks = 0;

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    async onopen(ws) {
      safeSend(ws, JSON.stringify({
        type: 'hello',
        ok: true,
        version: BACKEND_VERSION,
        ts: Date.now(),
        url: requestUrl,
        intervalMs,
        count,
      }));

      if (intervalMs > 0) {
        timer = setInterval(() => {
          ticks += 1;
          safeSend(ws, JSON.stringify({ type: 'tick', ticks, ts: Date.now() }));
          if (count > 0 && ticks >= count) {
            stopTimer();
            safeClose(ws, 1000, 'done');
          }
        }, intervalMs);
      }
    },

    async onmessage(ws, message, isBinary) {
      let payload = message;
      if (!isBinary && typeof payload !== 'string') {
        payload = payload?.toString?.() ?? String(payload);
      }

      safeSend(ws, JSON.stringify({
        type: 'echo',
        ts: Date.now(),
        isBinary: !!isBinary,
        data: payload,
      }));
    },

    async onclose(ws, code, reason) {
      stopTimer();
      safeClose(ws, sanitizeCloseCode(code), reason?.toString?.() || '');
    },

    async onerror() {
      stopTimer();
    },
  };
}

export { onRequest };
export default onRequest;
