# EdgeOne Load Balancer

A load balancer built on EdgeOne Pages, routing traffic across multiple origin targets with health monitoring and a built-in admin panel.

基于 EdgeOne Pages 构建的负载均衡器，支持多源目标流量分发、健康状态监控和内置管理面板。

---

## Architecture / 架构

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

**请求流程：**

1. `middleware.js` 判断主机名 — 管理域名走 Nuxt 渲染，其他域名 rewrite 到内部代理路径。
2. `edge-functions/__proxy/` 从 KV 读取规则，根据健康状态加权选择源目标并转发请求。
3. 每次代理请求触发后台健康检查，结果缓存在 KV 中，TTL 为 10 分钟。

## Origin Target Types / 源目标类型

| Type | Description | Failure conditions |
|------|-------------|-------------------|
| **FRP** | FRP reverse proxy | SSL handshake error (525), connection timeout, FRP signature error page |
| **Tunnel** | EdgeOne Tunnel | 530/502 responses, connection timeout |
| **Direct** | Direct origin connection | Connection timeout, non-2xx/3xx HTTP response |

## Project Structure / 目录结构

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

## Admin UI / 管理面板

The admin panel is accessible at your configured admin hostname (e.g. `elb.zetx.tech`) and provides:

管理面板通过管理域名访问（如 `elb.zetx.tech`），提供以下功能：

- **Global monitoring** — latency report URL and trigger-latency-check URL with one-click copy
- **Domain management** — add, edit, delete domains; configure health check path and HTTPS redirect
- **Origin targets** — add/remove FRP, Tunnel, or Direct targets per domain with health status and latency per target
- **Per-domain monitoring endpoints** — collapsible, per-domain health report and trigger URLs
- **Debug logs** — requests with `EdgeoneLBDebugger` header or User-Agent are logged and viewable in the UI
- **i18n** — Chinese / English toggle

## Deployment / 部署

### Prerequisites / 前置条件

- EdgeOne Pages project
- KV namespace bound as `lb_kv`

### Steps / 步骤

1. Create a KV namespace in the EdgeOne console (Edge Functions → KV Storage), then bind it to your Pages project with the variable name `lb_kv`.

   在 EdgeOne 控制台创建 KV 命名空间（边缘函数 → KV 存储），绑定到 Pages 项目，变量名设为 `lb_kv`。

2. Install dependencies and build:

   安装依赖并构建：

   ```bash
   npm install
   npm run build
   ```

3. Deploy:

   部署：

   ```bash
   edgeone pages deploy
   ```

4. Configure DNS: point your proxy domains (e.g. `elb-test.zetx.tech`) via CNAME to the Pages project domain.

   配置 DNS：将代理域名（如 `elb-test.zetx.tech`）通过 CNAME 指向 Pages 项目域名。

5. Access the admin panel at your admin hostname and add domains + origin targets.

   通过管理域名访问管理面板，添加域名和源目标。

## API Reference / 接口参考

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

## Debug Logging / 调试日志

Requests containing the header `EdgeoneLBDebugger` or a User-Agent string that includes `EdgeoneLBDebugger` are automatically logged. Logs are retained for 7 days (max 50 entries).

请求中包含 `EdgeoneLBDebugger` 请求头或 User-Agent 的，会自动记录调试日志。日志保留 7 天，最多 50 条。

## Tech Stack / 技术栈

- **Runtime**: EdgeOne Pages (Edge Functions + KV)
- **Frontend**: Nuxt 4, Vue 3, Tailwind CSS
- **Language**: JavaScript (ES Modules)

## License

Private — not for public distribution.
