// EdgeOne Pages Middleware
// Determines whether request goes to admin panel (Nuxt) or load balancer (Edge Function)

// Admin panel hostnames - requests to these hosts go to Nuxt
// All other hostnames are treated as proxied domains and go to load balancer
const ADMIN_HOSTNAMES = [
  'elb.zetx.tech'
];

export function middleware(context) {
  const { request, next, rewrite } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Check if this is the admin panel
  const isAdmin = ADMIN_HOSTNAMES.includes(hostname) ||
                  hostname.endsWith('.edgeone.run') || 
                  hostname.endsWith('.edgeone.site');

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
