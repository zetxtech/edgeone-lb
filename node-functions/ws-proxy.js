/**
 * Deprecated endpoint.
 *
 * WebSocket proxying has moved to the /__ws_proxy Node Function.
 */

export const onRequest = async () => {
  return new Response('Deprecated. Use /__ws_proxy.', {
    status: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
};
