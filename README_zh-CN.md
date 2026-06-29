# EdgeOne 负载均衡器

[English](./README.md)

基于 EdgeOne Pages 构建的负载均衡器，支持多源目标流量分发、健康状态监控和内置管理面板。

## 架构

```
                         ┌─────────────────────────────────────┐
                         │          EdgeOne Pages              │
                         ├─────────────────────────────────────┤
  请求 ─────────────────►│  middleware.js                       │
                         │  ├─ 管理域名  ──────► Nuxt (SSR)    │
                         │  └─ 代理域名  ──────► rewrite()     │
                         │                                     │
                         │  edge-functions/                    │
                         │  ├─ __proxy/        HTTP 代理       │
                         │  ├─ _health         健康报告        │
                         │  ├─ _trigger        触发检查        │
                         │  └─ api/            规则管理 & 日志  │
                         │                                     │
                         │  lb-proxy.js  (共享逻辑)             │
                         │  KV Storage   (lb_kv)               │
                         └─────────────────────────────────────┘
```

**请求流程：**

1. `middleware.js` 判断主机名 — 管理域名走 Nuxt 渲染，其他域名 rewrite 到内部代理路径。
2. `edge-functions/__proxy/` 从 KV 读取规则，根据健康状态加权选择源目标并转发请求。
3. 每次代理请求触发后台健康检查，结果缓存在 KV 中，TTL 为 10 分钟。

## 源目标类型

| 类型 | 说明 | 失败判定条件 |
|------|------|-------------|
| **FRP** | FRP 反向代理 | SSL 握手失败 (525)、连接超时、FRP 签名错误页 |
| **Tunnel** | EdgeOne Tunnel 隧道 | 530/502 响应、连接超时 |
| **Direct** | 直连源站 | 连接超时、HTTP 响应非 2xx/3xx |

## 目录结构

```
edgeone-lb/
├── middleware.js                    # 请求分流 — 管理 vs 代理
├── lb-proxy.js                     # 共享代理、健康检查、调试日志逻辑
├── edge-functions/
│   ├── __proxy/
│   │   ├── index.js                # 代理入口
│   │   └── [[default]].js          # 兜底代理处理
│   ├── _health.js                  # GET /_health — 缓存的健康报告
│   ├── _trigger_health_check.js    # GET /_trigger_health_check — 强制重新检查
│   └── api/
│       ├── export.js               # GET /api/export — 规则快照导出
│       ├── logs.js                 # GET /api/logs — 调试日志索引与详情
│       └── rules/
│           ├── index.js            # GET/POST /api/rules — 域名列表与创建
│           └── [domain].js         # GET/PUT/DELETE /api/rules/:domain
│               └── targets/
│                   ├── index.js    # POST /api/rules/:domain/targets
│                   └── [index].js  # DELETE /api/rules/:domain/targets/:index
├── app/
│   └── pages/index.vue             # 管理界面 (Nuxt + Vue 3 + Tailwind CSS)
├── nuxt.config.ts
├── package.json
└── tailwind.config.js
```

## 管理面板

通过管理域名访问（如 `elb.zetx.tech`），提供以下功能：

- **全局监控** — 延迟报告地址和触发延迟检查地址，一键复制
- **域名管理** — 添加、编辑、删除域名；配置健康检查路径和 HTTPS 跳转
- **源目标管理** — 按域名添加/移除 FRP、Tunnel 或 Direct 目标，每个目标显示健康状态和延迟
- **按域名监控端点** — 可折叠的按域名健康报告和触发地址
- **调试日志** — 包含 `EdgeoneLBDebugger` 请求头或 User-Agent 的请求会自动记录，可在界面查看
- **中英文切换**

## 部署

### 前置条件

- EdgeOne Pages 项目
- KV 命名空间，绑定变量名 `lb_kv`

### 步骤

1. 在 EdgeOne 控制台创建 KV 命名空间（边缘函数 → KV 存储），绑定到 Pages 项目，变量名设为 `lb_kv`。

2. 安装依赖并构建：

   ```bash
   npm install
   npm run build
   ```

3. 部署：

   ```bash
   edgeone pages deploy
   ```

4. 配置 DNS：将代理域名（如 `elb-test.zetx.tech`）通过 CNAME 指向 Pages 项目域名。

5. 通过管理域名访问管理面板，添加域名和源目标。

## 接口参考

| 接口 | 方法 | 说明 |
|------|------|------|
| `/_health` | GET | 返回所有域名的缓存健康报告 |
| `/_trigger_health_check` | GET | 触发所有目标的健康检查，返回更新后的报告 |
| `/api/rules` | GET | 获取所有域名规则 |
| `/api/rules` | POST | 创建或更新域名规则 |
| `/api/rules/:domain` | GET | 获取单个域名规则 |
| `/api/rules/:domain` | DELETE | 删除域名规则 |
| `/api/rules/:domain/targets` | POST | 为域名添加源目标 |
| `/api/rules/:domain/targets/:index` | DELETE | 按索引移除源目标 |
| `/api/logs` | GET | 获取最近的调试日志列表 |
| `/api/logs?id=<id>` | GET | 获取单条调试日志详情 |
| `/api/export` | GET | 导出所有规则快照 |

## 调试日志

请求中包含 `EdgeoneLBDebugger` 请求头或 User-Agent 的，会自动记录调试日志。日志保留 7 天，最多 50 条。

## 技术栈

- **运行时**: EdgeOne Pages (Edge Functions + KV)
- **前端**: Nuxt 4, Vue 3, Tailwind CSS
- **语言**: JavaScript (ES Modules)

## 许可证

私有项目，不对外分发。
