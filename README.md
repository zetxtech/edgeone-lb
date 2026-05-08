# EdgeOne Load Balancer Admin Panel

基于 EdgeOne Pages 的负载均衡管理面板，通过 Middleware、Edge Functions 与 Node Functions 协同处理管理端、HTTP 代理和 WebSocket 代理。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    EdgeOne Pages                            │
├─────────────────────────────────────────────────────────────┤
│  middleware.js (Runs on Edge Nodes)                         │
│  ├── admin hostname  ─────────► next() ──────► Nuxt SSR     │
│  ├── WebSocket proxy ────────► rewrite() ───► Node Fn       │
│  └── HTTP proxy ─────────────► rewrite() ───► Edge Fn       │
│                                                             │
│  lb-proxy.js                                                │
│  └── Shared proxy / health-check logic                      │
│                                                             │
│  edge-functions/                                            │
│  ├── __proxy/[[default]].js                                 │
│  ├── _health.js / _trigger_health_check.js                  │
│  └── api/                                                   │
│      └── rules / logs / export                              │
│                                                             │
│  node-functions/__ws_proxy/index.js                         │
│  └── Upstream WebSocket proxy                               │
│                                                             │
│  KV Storage (lb_kv)                                         │
│  └── rules: { "domain": { targets: [...], ... } }           │
└─────────────────────────────────────────────────────────────┘
```

**架构说明：**

- **Middleware 只负责分流与改写**：管理域名走 Nuxt，HTTP 代理请求 rewrite 到 Edge Functions，WebSocket 请求 rewrite 到 Node Functions
- **管理面板使用 Nuxt**：管理域名（如 `*.edgeone.run`）的请求通过 `next()` 传递给 Nuxt 进行 SSR 渲染
- **共享代理逻辑在 lb-proxy.js**：HTTP 代理、健康检查、调试日志与 WebSocket 目标选择复用同一套规则读取与候选排序逻辑
- **API 使用 Edge Functions**：规则管理、调试日志和导出接口都由 Edge Functions 提供

## 目录结构

```
edgeone-lb/
├── middleware.js              # 请求分流与 rewrite 入口
├── lb-proxy.js                # 共享代理与健康检查逻辑
├── edge-functions/
│   ├── __proxy/              # HTTP 代理入口
│   ├── _health.js            # 管理域名健康状态查询
│   ├── _trigger_health_check.js
│   └── api/
│       ├── export.js         # 导出规则快照
│       ├── logs.js           # 调试日志 API
│       └── rules/            # 规则管理 API
├── node-functions/
│   └── __ws_proxy/           # WebSocket 代理入口
├── app/
│   └── pages/index.vue       # 管理界面
├── nuxt.config.ts
└── package.json
```

**注意：** 当前 HTTP 代理主逻辑不再直接堆在 middleware.js 中，而是通过内部 rewrite 交给 edge-functions/__proxy 和共享模块 lb-proxy.js。

## 部署步骤

### 1. 创建 KV 命名空间

在 EdgeOne 控制台创建 KV 命名空间：

1. 进入 EdgeOne 控制台 → 边缘函数 → KV 存储
2. 创建新的命名空间，记录命名空间 ID
3. 在 Pages 项目设置中绑定 KV，变量名设为 `lb_kv`

### 2. 部署到 EdgeOne Pages

```bash
cd admin
npm install
npm run build
edgeone pages deploy
```

### 3. 配置域名

1. 管理域名：使用默认的 `*.edgeone.run` 域名访问管理面板
2. 代理域名：将需要负载均衡的域名 CNAME 到 Pages 项目域名

### 4. 环境变量（可选）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `ADMIN_HOSTNAME` | 管理面板域名 | `*.edgeone.run` / `*.edgeone.site` |

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 使用 EdgeOne CLI 本地测试（包含 Edge Functions）
edgeone pages dev
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rules` | 获取所有规则 |
| POST | `/api/rules` | 创建/更新域名规则（支持域名重命名） |
| DELETE | `/api/rules/:domain` | 删除域名 |
| POST | `/api/rules/:domain/targets` | 添加后端目标 |
| DELETE | `/api/rules/:domain/targets/:index` | 删除后端目标 |
| GET | `/api/export` | 导出当前规则快照 JSON |

### 创建/更新域名规则

```json
POST /api/rules
{
  "domain": "api.example.com",
  "oldDomain": "old.example.com",  // 可选，用于域名重命名
  "rule": {
    "forceHttps": true,
    "healthPath": "/",
    "platform": "edgeone",  // 平台标识
    "targets": [
      { "host": "backend1.example.com", "type": "frp" },
      { "host": "backend2.example.com", "type": "tunnel" }
    ]
  }
}
```

## 功能特性

### ✅ 域名管理
- **可编辑域名**：支持修改域名名称，系统会自动处理重命名逻辑
- **强制 HTTPS**：可配置是否强制 302 重定向到 HTTPS
- **Health Check 路径**：配置健康检查路径（默认 `/`）
- **平台标识**：所有配置自动标记为 `edgeone` 平台

### ✅ 后端目标管理
- 支持三种后端类型：
  - `frp`：FRP 代理
  - `tunnel`：Cloudflare Tunnel
  - `direct`：直连
- 动态添加/删除后端目标
- 按健康状态和延迟排序的串行故障转移

### ✅ 健康检查端点
访问 `https://your-domain.com/_health` 可查看当前配置状态（从缓存读取）：

```json
{
  "backend1.example.com": {
    "type": "frp",
    "status": "healthy",
    "latency": "45ms",
    "last_update": "2026-01-19 18:30:00",
    "reason": "OK"
  },
  "backend2.example.com": {
    "type": "tunnel",
    "status": "unhealthy",
    "latency": "TimeOut",
    "last_update": "2026-01-19 18:29:55",
    "reason": "Timeout"
  }
}
```

### ✅ 触发健康检查端点 🆕
访问 `https://your-domain.com/_trigger_health_check` 可主动触发对所有后端的健康检查并更新缓存：

```json
{
  "backend1.example.com": {
    "type": "frp",
    "status": "healthy",
    "latency": "45ms",
    "last_update": "2026-01-19 18:30:00",
    "reason": "OK"
  },
  "backend2.example.com": {
    "type": "tunnel",
    "status": "unhealthy",
    "latency": "120ms",
    "last_update": "2026-01-19 18:30:00",
    "reason": "HTTP 502"
  },
  "backend3.example.com": {
    "type": "direct",
    "status": "unhealthy",
    "latency": "TimeOut",
    "last_update": "2026-01-19 18:30:00",
    "reason": "Timeout"
  }
}
```

**特点：**
- 实时探测所有后端健康状态
- 结果自动缓存 10 分钟（使用 Cache API）
- 返回格式与 `/_health` 完全一致
- 支持 CORS（`Access-Control-Allow-Origin: *`）

**用途：**
- 配合外部监控服务（UptimeRobot、Pingdom、监控宝等）定时触发
- 主动探测所有后端的健康状态
- 获取实时的延迟和状态码信息
- 用于告警和监控集成

### ✅ 配置导出
点击 "Export Rules" 按钮会下载当前规则快照 JSON，可用于备份、审计或迁移配置。

## 与原 Worker 版本的区别

| 特性 | Worker 版本 (worker.js) | EdgeOne 版本 |
|------|------------------------|------------------------------|
| 配置方式 | 硬编码在代码中 | 存储在 KV，可通过管理面板修改 |
| 域名管理 | 需要修改代码 | 可在线编辑，支持重命名 |
| Health Check | Cron Trigger 后台定时检查 | HTTP 触发（外部监控服务） |
| 健康检查缓存 | Cache API（10 分钟 TTL） | Cache API（10 分钟 TTL） |
| 健康检查触发 | `scheduled` 事件自动触发 | `/_trigger_health_check` 手动触发 |
| 健康状态查询 | `/_health` 从缓存读取 | `/_health` 从缓存读取 |
| 平台标识 | 无 | 自动标记 `platform: "edgeone"` |
| 负载均衡 | 串行故障转移 + 健康度排序 | 串行故障转移 + 健康度排序 |
| 部署方式 | Cloudflare Workers | EdgeOne Pages |

**主要差异说明：**
- Worker 版本使用 Cron Trigger 自动定时检查，EdgeOne 版本需要外部服务触发
- 两者都使用 Cache API 缓存健康检查结果，TTL 均为 10 分钟
- 当前 EdgeOne 版本同样会根据健康状态和延迟排序候选后端
- 返回格式完全一致，便于迁移和监控集成

## 监控集成示例

### 使用 UptimeRobot
1. 创建新的 HTTP(s) 监控
2. URL: `https://your-domain.com/_trigger_health_check`
3. 监控间隔: 5 分钟
4. 关键字监控: `"status"` 或 `"healthy"`（确保返回正确）

### 使用 Pingdom
1. 添加 Uptime Check
2. URL: `https://your-domain.com/_trigger_health_check`
3. Check interval: 5 minutes
4. Response validation: Contains `"status"`

### 使用监控宝
1. 创建 HTTP 监控
2. URL: `https://your-domain.com/_trigger_health_check`
3. 监控频率: 5 分钟
4. 响应内容包含: `status`

### 使用 cURL + Cron
```bash
# 添加到 crontab
*/5 * * * * curl -s https://your-domain.com/_trigger_health_check > /dev/null

# 或者带告警
*/5 * * * * curl -s https://your-domain.com/_trigger_health_check | jq -e '.[] | select(.status=="unhealthy")' && echo "Backend down!" | mail -s "Alert" admin@example.com
```

### 使用 GitHub Actions
```yaml
name: Health Check
on:
  schedule:
    - cron: '*/5 * * * *'  # 每 5 分钟
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Health Check
        run: |
          RESPONSE=$(curl -s https://your-domain.com/_trigger_health_check)
          echo "$RESPONSE" | jq .
          
          # Check for unhealthy backends
          UNHEALTHY=$(echo "$RESPONSE" | jq -r '.[] | select(.status=="unhealthy") | .host')
          if [ -n "$UNHEALTHY" ]; then
            echo "::error::Unhealthy backends detected: $UNHEALTHY"
            exit 1
          fi
```

### 使用 Cloudflare Workers Cron (推荐)
如果你有 Cloudflare Workers，可以创建一个定时触发器：

```javascript
export default {
  async scheduled(event, env, ctx) {
    const domains = [
      'domain1.com',
      'domain2.com',
      'domain3.com'
    ];
    
    for (const domain of domains) {
      try {
        const response = await fetch(`https://${domain}/_trigger_health_check`);
        const data = await response.json();
        console.log(`Health check for ${domain}:`, data);
        
        // 可以在这里添加告警逻辑
        for (const [host, status] of Object.entries(data)) {
          if (status.status === 'unhealthy') {
            console.error(`Backend ${host} is unhealthy!`);
            // 发送告警通知
          }
        }
      } catch (e) {
        console.error(`Failed to check ${domain}:`, e);
      }
    }
  }
};
```

在 `wrangler.toml` 中配置：
```toml
[triggers]
crons = ["*/5 * * * *"]  # 每 5 分钟执行一次
```

## 注意事项

1. **域名重命名**：编辑域名时修改域名名称会删除旧域名并创建新域名，所有后端目标会自动迁移
2. **Health Check**：`healthPath` 配置会在 `/_health` 端点中显示，但实际健康检查需要在后端实现
3. **平台标识**：所有通过管理面板创建的配置都会自动添加 `platform: "edgeone"` 标识
4. **响应头**：所有代理请求会添加以下响应头：
   - `X-LB-Backend`: 实际处理请求的后端地址
   - `X-LB-Powered-By`: EdgeOne-LB
   - `X-LB-Platform`: edgeone
| POST | `/api/rules/:domain/targets` | 添加后端目标 |
| DELETE | `/api/rules/:domain/targets/:index` | 删除后端目标 |
| GET | `/api/export` | 导出独立 Edge Function |

## 规则数据结构

```json
{
  "example.com": {
    "forceHttps": true,
    "healthPath": "/health",
    "targets": [
      { "host": "backend1.example.com", "port": 443, "type": "direct" },
      { "host": "backend2.example.com", "port": 443, "type": "frp" }
    ]
  }
}
```

## 目标类型

- **direct**: 直接转发到后端服务器
- **frp**: FRP 内网穿透服务
- **tunnel**: Cloudflare Tunnel 等隧道服务

## 导出功能

管理面板支持导出独立的 Middleware 代码，包含当前所有规则配置。导出的代码可以直接部署到其他 EdgeOne 项目，无需管理面板和 KV 存储。

## 构建

```bash
npm run build
```
