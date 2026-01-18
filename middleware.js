// EdgeOne Pages Middleware
// Determines whether request goes to admin panel (Nuxt) or load balancer (Edge Function)

// Admin panel hostname - requests to this host go to Nuxt
// All other hostnames are treated as proxied domains and go to load balancer
const ADMIN_HOSTNAME = process.env.ADMIN_HOSTNAME || '';

export function middleware(context) {
  const { request, next, rewrite } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Check if this is the admin panel
  // If ADMIN_HOSTNAME is not set, use the default EdgeOne Pages domain (*.edgeone.run)
  const isAdmin = ADMIN_HOSTNAME 
    ? hostname === ADMIN_HOSTNAME 
    : hostname.endsWith('.edgeone.run') || hostname.endsWith('.edgeone.site');

  if (isAdmin) {
    // Admin panel request -> pass through to Nuxt
    return next();
  }

  // Proxied domain request -> rewrite to load balancer Edge Function
  // Preserve the original path and query string
  const originalPath = url.pathname + url.search;
  return rewrite(`/_lb${originalPath}`);
}

// Match all routes
export const config = {
  matcher: '/:path*'
};
