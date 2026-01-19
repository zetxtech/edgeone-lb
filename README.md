# EdgeOne Load Balancer Admin Panel

基于 EdgeOne Pages 的负载均衡管理面板，支持多域名 CNAME 到同一 Pages 项目，通过 Middleware 区分管理端和代理端。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    EdgeOne Pages                            │
├─────────────────────────────────────────────────────────────┤
│  middleware.js (Runs on Edge Nodes)                         │
│  ├── admin.edgeone.run  ──────► next() ──────► Nuxt SSR     │
│  └── other-domain.com   ──────► Load Balancer Logic         │
│      └── Read rules from KV → Select backend → Proxy        │
│                                                             │
│  edge-functions/api/                                        │
│  └── rules/                                                 │
│      └── CRUD API for managing rules                        │
│                                                             │
│  KV Storage (lb_kv)                                         │
│  └── rules: { "domain": { targets: [...], ... } }           │
└─────────────────────────────────────────────────────────────┘
```

**架构说明：**

- **Middleware 直接处理负载均衡**：所有代理域名的请求在 middleware 中直接读取 KV 规则并转发到后端，无需经过 Nuxt 或 Edge Functions
- **管理面板使用 Nuxt**：管理域名（如 `*.edgeone.run`）的请求通过 `next()` 传递给 Nuxt 进行 SSR 渲染
- **API 使用 Edge Functions**：规则管理 API 使用 Edge Functions 实现，提供 RESTful 接口

## 目录结构

```
edgeone-lb/
├── middleware.js              # 请求路由和负载均衡中间件
├── edge-functions/
│   └── api/
│       ├── export.js         # 导出独立配置
│       └── rules/            # 规则管理 API
│           ├── index.js
│           ├── [domain].js
│           └── [domain]/targets/
├── app/
│   └── pages/index.vue       # 管理界面
├── nuxt.config.ts
└── package.json
```

**注意：** `edge-functions/_lb/` 目录已移除，负载均衡逻辑现在直接在 `middleware.js` 中实现。

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
| POST | `/api/rules` | 创建/更新域名规则 |
| DELETE | `/api/rules/:domain` | 删除域名 |
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
