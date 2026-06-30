# EdgeOne 负载均衡器

[English](./README.md)

运行在 EdgeOne Pages 上的负载均衡器，支持基于健康状态的流量分发、KV 规则存储和内置管理面板。

![管理面板](.github/screenshot.png)

## 功能

- **多源站路由** — 在 FRP、Tunnel 或 Direct 目标之间按健康权重分发流量
- **健康监控** — 自动后台健康检查，可按目标类型配置不同的失败判定条件
- **管理面板** — 通过双语（中文/英文）Web 界面管理域名和源目标
- **调试日志** — 通过自定义请求头或 User-Agent 选择性记录请求轨迹
- **零服务器** — 完全运行在 EdgeOne Pages 边缘函数和 KV 存储之上

> **注意：** 由于 EdgeOne Pages 对出站 WebSocket 的限制，本项目不支持 WebSocket 负载均衡，仅支持 HTTP 流量。

## 部署

1. **创建 KV 命名空间** — 进入 EdgeOne 控制台 → 边缘函数 → KV 存储，创建一个新的命名空间。

2. **绑定到 Pages 项目** — 在 Pages 项目设置中添加 KV 绑定，变量名填 `lb_kv`，选择刚创建的命名空间。

3. **安装、构建、部署：**

   ```bash
   npm install
   npm run build
   edgeone pages deploy
   ```

4. **配置 DNS** — 将你的代理域名通过 CNAME 指向 Pages 项目域名。

5. 访问管理域名，即可开始添加规则和源目标。

6. **配置外部监控** — 健康检查仅在代理请求触发时运行。为保持延迟数据新鲜，可使用 [UptimeRobot](https://uptimerobot.com/)、[Freshping](https://www.freshworks.com/website-monitoring/) 等 HTTP 监控服务，定期轮询管理域名的 `/_trigger_health_check` 接口（如每 5 分钟一次），确保健康状态和延迟始终是最新的。

## 配置

规则存储在 `lb_kv` 绑定的 KV 中。管理面板提供完整的增删改查功能，无需手动编辑 KV。

每条域名规则包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `targets` | array | 源站列表，每项包含 `host`、`type` |
| `forceHttps` | boolean | 是否将 HTTP 重定向到 HTTPS |
| `healthPath` | string | 源站健康检查路径（如 `/health`） |
| `platform` | string | 固定为 `"edgeone"` |

## 源目标类型

| 类型 | 说明 | 失败判定条件 |
|------|------|-------------|
| **FRP** | FRP 反向代理 | SSL 握手失败 (525)、连接超时、FRP 签名错误页 |
| **Tunnel** | EdgeOne Tunnel 隧道 | 530/502 响应、连接超时 |
| **Direct** | 直连源站 | 连接超时、HTTP 响应非 2xx/3xx |

## 接口参考

| 接口 | 方法 | 说明 |
|------|------|------|
| `/_health` | GET | 所有域名的缓存健康报告 |
| `/_trigger_health_check` | GET | 强制重新检查所有目标，返回更新后的报告 |
| `/api/rules` | GET | 获取所有域名规则 |
| `/api/rules` | POST | 创建或更新域名规则 |
| `/api/rules/:domain` | GET | 获取单个域名规则 |
| `/api/rules/:domain` | DELETE | 删除域名规则 |
| `/api/rules/:domain/targets` | POST | 添加源目标 |
| `/api/rules/:domain/targets/:index` | DELETE | 按索引移除源目标 |
| `/api/logs` | GET | 最近的调试日志列表 |
| `/api/logs?id=<id>` | GET | 单条调试日志详情 |
| `/api/export` | GET | 导出完整规则快照 |

## 调试日志

请求中携带 `EdgeoneLBDebugger` 请求头或 User-Agent 子串的，会自动记录。日志保留 7 天，最多 50 条。

## 技术栈

- **运行时** — EdgeOne Pages (Edge Functions + KV)
- **前端** — Nuxt 4, Vue 3, Tailwind CSS
- **语言** — JavaScript (ES Modules)

## 许可证

[GPL-3.0](./LICENSE)
