# EdgeOne Load Balancer

[中文](./README_zh-CN.md)

A load balancer running on EdgeOne Pages, with health-aware traffic routing, KV-backed rules, and a built-in admin UI.

## Features

- **Multi-origin routing** — distribute traffic across FRP, Tunnel, or Direct targets with health-weighted selection
- **Health monitoring** — automatic background health checks with configurable failure detection per target type
- **Admin panel** — manage domains and origin targets through a bilingual (EN/ZH) web UI
- **Debug logging** — opt-in request tracing via a custom header or User-Agent
- **Zero servers** — runs entirely on EdgeOne Pages edge functions and KV storage
> **Note:** Due to EdgeOne Pages limitations on outbound WebSocket connections, this project does not support WebSocket load balancing — HTTP traffic only.
## Deployment

1. **Create a KV namespace** — Go to the EdgeOne console → Edge Functions → KV Storage and create a new namespace.

2. **Bind it to your Pages project** — In the Pages project settings, add a KV binding with variable name `lb_kv` and select the namespace you just created.

3. **Install, build, and deploy:**

   ```bash
   npm install
   npm run build
   edgeone pages deploy
   ```

4. **Configure DNS** — Point your proxy domains to the Pages project domain via CNAME.

5. Visit your admin domain to start adding rules and origin targets.

## Configuration

Rules are stored in KV under the `lb_kv` binding. The admin UI provides full CRUD — no manual KV editing required.

Each domain rule contains:

| Field | Type | Description |
|-------|------|-------------|
| `targets` | array | List of origin backends, each with `host`, `type` |
| `forceHttps` | boolean | Whether to redirect HTTP to HTTPS |
| `healthPath` | string | Path used for origin health checks (e.g. `/health`) |
| `platform` | string | Always `"edgeone"` |

## Origin Target Types

| Type | Description | Failure conditions |
|------|-------------|-------------------|
| **FRP** | FRP reverse proxy | SSL handshake error (525), connection timeout, FRP signature error page |
| **Tunnel** | EdgeOne Tunnel | 530/502 responses, connection timeout |
| **Direct** | Direct origin connection | Connection timeout, non-2xx/3xx HTTP response |

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/_health` | GET | Cached health report for all domains |
| `/_trigger_health_check` | GET | Force re-check all targets, return updated report |
| `/api/rules` | GET | List all domain rules |
| `/api/rules` | POST | Create or update a domain rule |
| `/api/rules/:domain` | GET | Get a single domain rule |
| `/api/rules/:domain` | DELETE | Delete a domain rule |
| `/api/rules/:domain/targets` | POST | Add an origin target |
| `/api/rules/:domain/targets/:index` | DELETE | Remove an origin target by index |
| `/api/logs` | GET | List recent debug log entries |
| `/api/logs?id=<id>` | GET | Get a single debug log entry |
| `/api/export` | GET | Export full rules snapshot |

## Debug Logging

Requests carrying the `EdgeoneLBDebugger` request header or User-Agent substring are automatically recorded. Logs are retained for 7 days, up to 50 entries.

## Tech Stack

- **Runtime** — EdgeOne Pages (Edge Functions + KV)
- **Frontend** — Nuxt 4, Vue 3, Tailwind CSS
- **Language** — JavaScript (ES Modules)

## License

Proprietary — not distributed externally.
