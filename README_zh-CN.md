# EdgeOne 负载均衡器

[English](./README.md)

[![Deploy with EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fzetxtech%2Fedgeone-lb)

运行在 EdgeOne Pages 上的负载均衡器，支持基于健康状态的流量分发和内置管理面板。

![管理面板](.github/screenshot.png)

## 功能

- **多源站路由** — 在 FRP、Tunnel 或 Direct 目标之间按健康权重分发流量
- **健康监控** — 自动后台健康检查，可按目标类型配置不同的失败判定条件
- **管理面板** — 通过中英文双语 Web 界面管理域名和源目标
- **调试日志** — 可选的请求追踪，方便排查问题

> **注意：** 由于 EdgeOne Pages 对出站连接的限制，本项目不支持 WebSocket，仅支持 HTTP 流量。

## 源目标类型

| 类型 | 说明 | 失败判定条件 |
|------|------|-------------|
| **FRP** | FRP 反向代理 | SSL 握手失败 (525)、连接超时、FRP 签名错误页 |
| **Tunnel** | EdgeOne Tunnel 隧道 | 530/502 响应、连接超时 |
| **Direct** | 直连源站 | 连接超时、HTTP 响应非 2xx/3xx |

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

6. **配置外部监控** — 健康检查仅在代理请求触发时运行。为保持延迟数据新鲜，可使用 [UptimeRobot](https://uptimerobot.com/)、[Freshping](https://www.freshworks.com/website-monitoring/) 等服务定期轮询 `/_trigger_health_check`（如每 5 分钟一次），确保健康状态始终是最新的。

## 许可证

GNU General Public License v3.0
