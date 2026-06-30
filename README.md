# EdgeOne Load Balancer

[中文](./README_zh-CN.md)

A load balancer running on EdgeOne Pages, with health-aware traffic routing and a built-in admin panel.

![Admin Panel](.github/screenshot.png)

## Features

- **Multi-origin routing** — distribute traffic across FRP, Tunnel, or Direct targets with health-weighted selection
- **Health monitoring** — automatic background health checks with configurable failure detection per target type
- **Admin panel** — manage domains and origin targets through a bilingual (EN/ZH) web UI
- **Debug logging** — optional request tracing for troubleshooting

> **Note:** Due to EdgeOne Pages limitations on outbound connections, this project does not support WebSocket — HTTP traffic only.

## Origin Target Types

| Type | Description | Failure conditions |
|------|-------------|-------------------|
| **FRP** | FRP reverse proxy | SSL handshake error (525), connection timeout, FRP signature error page |
| **Tunnel** | EdgeOne Tunnel | 530/502 responses, connection timeout |
| **Direct** | Direct origin connection | Connection timeout, non-2xx/3xx HTTP response |

## Deployment

[![Deploy with EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fzetxtech%2Fedgeone-lb)

Click the button above to deploy on EdgeOne Makers. After deployment:

1. **Bind a KV namespace** — Add a KV binding in project settings with variable name `lb_kv`.
2. **Configure DNS** — Point your proxy domains to the Pages project domain via CNAME.
3. **Set up external monitoring (optional)** — Use [UptimeRobot](https://uptimerobot.com/) or similar to periodically poll `/_trigger_health_check` and keep latency data fresh.

## License

GNU General Public License v3.0
