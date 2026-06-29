# EdgeOne Load Balancer

[中文](./README_zh-CN.md)

A load balancer built on EdgeOne Pages, routing traffic across multiple origin targets with health monitoring and a built-in admin panel.

## Architecture

```
                         ┌─────────────────────────────────────┐
                         │          EdgeOne Pages              │
                         ├─────────────────────────────────────┤
  Request ──────────────►│  middleware.js                       │
                         │  ├─ Admin hostname  ──► Nuxt (SSR)  │
                         │  └─ Proxy hostname  ──► rewrite()   │
                         │                                     │
                         │  edge-functions/                    │
                         │  ├─ __proxy/        HTTP proxy      │
                         │  ├─ _health         Health report   │
                         │  ├─ _trigger        Trigger checks  │
                         │  └─ api/            CRUD & logs     │
                         │                                     │
                         │  lb-proxy.js  (shared logic)        │
                         │  KV Storage   (lb_kv)               │
                         └─────────────────────────────────────┘
```

**Request flow:**

1. `middleware.js` inspects the hostname — admin domains pass through to Nuxt, all other domains are rewritten to the internal proxy path.
2. `edge-functions/__proxy/` reads rules from KV, selects an origin target via health-aware scoring, and forwards the request.
3. Health checks run in the background on each proxy pass; results are cached in KV with a 10-minute TTL.

## Origin Target Types

| Type | Description | Failure conditions |
|------|-------------|-------------------|
| **FRP** | FRP reverse proxy | SSL handshake error (525), connection timeout, FRP signature error page |
| **Tunnel** | EdgeOne Tunnel | 530/502 responses, connection timeout |
| **Direct** | Direct origin connection | Connection timeout, non-2xx/3xx HTTP response |

## Project Structure

```
edgeone-lb/
├── middleware.js                    # Request routing — admin vs proxy
├── lb-proxy.js                     # Shared proxy, health check, and debug log logic
├── edge-functions/
│   ├── __proxy/
│   │   ├── index.js                # Proxy entry point
│   │   └── [[default]].js          # Catch-all proxy handler
│   ├── _health.js                  # GET /_health — cached health report
│   ├── _trigger_health_check.js    # GET /_trigger_health_check — force recheck
│   └── api/
│       ├── export.js               # GET /api/export — rules snapshot
│       ├── logs.js                 # GET /api/logs — debug log index & detail
│       └── rules/
│           ├── index.js            # GET/POST /api/rules — list & create domains
│           └── [domain].js         # GET/PUT/DELETE /api/rules/:domain
│               └── targets/
│                   ├── index.js    # POST /api/rules/:domain/targets
│                   └── [index].js  # DELETE /api/rules/:domain/targets/:index
├── app/
│   └── pages/index.vue             # Admin UI (Nuxt + Vue 3 + Tailwind CSS)
├── nuxt.config.ts
├── package.json
└── tailwind.config.js
```

## Admin UI

Accessible at your configured admin hostname (e.g. `elb.zetx.tech`):

- **Global monitoring** — latency report URL and trigger-latency-check URL with one-click copy
- **Domain management** — add, edit, delete domains; configure health check path and HTTPS redirect
- **Origin targets** — add/remove FRP, Tunnel, or Direct targets per domain with health status and latency per target
- **Per-domain monitoring endpoints** — collapsible, per-domain health report and trigger URLs
- **Debug logs** — requests with `EdgeoneLBDebugger` header or User-Agent are logged and viewable
- **i18n** — Chinese / English toggle

## Deployment

### Prerequisites

- EdgeOne Pages project
- KV namespace bound as `lb_kv`

### Steps

1. Create a KV namespace in the EdgeOne console (Edge Functions → KV Storage), then bind it to your Pages project with the variable name `lb_kv`.

2. Install and build:

   ```bash
   npm install
   npm run build
   ```

3. Deploy:

   ```bash
   edgeone pages deploy
   ```

4. Configure DNS: point your proxy domains (e.g. `elb-test.zetx.tech`) via CNAME to the Pages project domain.

5. Access the admin panel at your admin hostname and add domains + origin targets.

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/_health` | GET | Returns cached health report for all domains |
| `/_trigger_health_check` | GET | Triggers a fresh health check for all targets, then returns updated report |
| `/api/rules` | GET | List all domain rules |
| `/api/rules` | POST | Create or update a domain rule |
| `/api/rules/:domain` | GET | Get a single domain rule |
| `/api/rules/:domain` | DELETE | Delete a domain rule |
| `/api/rules/:domain/targets` | POST | Add an origin target to a domain |
| `/api/rules/:domain/targets/:index` | DELETE | Remove an origin target by index |
| `/api/logs` | GET | List recent debug log entries |
| `/api/logs?id=<id>` | GET | Get a single debug log detail |
| `/api/export` | GET | Export a snapshot of all rules |

## Debug Logging

Requests containing the header `EdgeoneLBDebugger` or a User-Agent string that includes `EdgeoneLBDebugger` are automatically logged. Logs are retained for 7 days (max 50 entries).

## Tech Stack

- **Runtime**: EdgeOne Pages (Edge Functions + KV)
- **Frontend**: Nuxt 4, Vue 3, Tailwind CSS
- **Language**: JavaScript (ES Modules)

## License

Private — not for public distribution.
