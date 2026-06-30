# EdgeOne 负载均衡器

[English / 英文 README](./README.md) · [![Deploy with EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fzetxtech%2Fedgeone-lb)

运行在 EdgeOne Pages 上的负载均衡器，支持基于健康状态的流量分发和内置管理面板。

![管理面板](.github/screenshot_zh.png)

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

[![Deploy with EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fzetxtech%2Fedgeone-lb)

点击上方按钮，在 EdgeOne Makers 中一键部署。部署完成后还需要完成以下配置：

1. **绑定 KV 命名空间** — 进入 EdgeOne 控制台，切换到 Makers 页签，点击你的项目进入项目详情。在左侧菜单选择「存储 → KV 存储」，点击「绑定命名空间」，变量名填 `lb_kv`，选择或创建一个 KV 命名空间。

2. **配置 DNS** — 在你的域名 DNS 设置中，将需要负载均衡的域名（如 `api.example.com`）通过 CNAME 记录指向 Pages 项目分配的域名。

3. **配置外部监控** — 健康检查仅在有请求经过负载均衡时触发，如果没有流量，延迟数据会过期。使用 [UptimeRobot](https://uptimerobot.com/)、[Freshping](https://www.freshworks.com/website-monitoring/) 等免费监控服务，创建一个 HTTP 监控项，地址填入管理域名的 `/_trigger_health_check`，间隔设为 5 分钟即可。

## 许可证

GNU General Public License v3.0
