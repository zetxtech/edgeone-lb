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

function buildCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(request),
  });
}

// GET /api/test/sse?intervalMs=1000&count=10
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const intervalMs = parseIntParam(url, 'intervalMs', 1000, { min: 100, max: 60_000 });
  const count = parseIntParam(url, 'count', 10, { min: 1, max: 10_000 });

  const encoder = new TextEncoder();
  let timer = null;
  let index = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text));

      // Initial comment helps some proxies flush headers.
      send(`: ok\n\n`);
      send(`event: open\ndata: ${JSON.stringify({ ok: true, intervalMs, count, ts: Date.now() })}\n\n`);

      timer = setInterval(() => {
        index += 1;
        send(`id: ${index}\n`);
        send(`event: tick\n`);
        send(`data: ${JSON.stringify({ index, ts: Date.now() })}\n\n`);

        if (index >= count) {
          clearInterval(timer);
          timer = null;
          send(`event: done\ndata: ${JSON.stringify({ ok: true, count, ts: Date.now() })}\n\n`);
          controller.close();
        }
      }, intervalMs);
    },
    cancel() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...buildCorsHeaders(request),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      // Helpful for some reverse proxies; harmless elsewhere.
      'X-Accel-Buffering': 'no',
    },
  });
}
