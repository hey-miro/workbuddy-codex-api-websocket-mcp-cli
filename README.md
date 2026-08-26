# Desktop Agent Dispatcher

这个 Demo 展示如何从外部系统向 Codex Desktop 或 WorkBuddy 的原会话投递任务。

Codex 通道使用官方 Codex App Server 协议：

1. 本机 Companion 启动 `codex app-server --stdio`。
2. 网页通过 `127.0.0.1:5126` 请求本机 Companion。
3. Companion 使用 `thread/list` 读取桌面任务。
4. 投递时依次调用 `thread/resume` 和 `turn/start`，在原任务中继续执行。
5. `turn/*` 与 `item/*` 通知用于同步状态和回复。

WorkBuddy 与 Codex 的技术选型、总体架构和生产化设计见：

- [WorkBuddy 与 Codex 原会话任务注入方案设计](docs/SOLUTION-DESIGN.md)

## 本地运行

终端一：

```bash
npm install
npm run companion
```

Companion 启动后会显示一个临时 Token。将它复制到网页左下角的“本机 Companion”设置中。

终端二：

```bash
npm run dev
```

打开 `http://localhost:3000`。

## 安全边界

- Companion 仅监听 `127.0.0.1`。
- 列出任务和投递任务都必须携带临时 Token。
- 默认只允许本地 Demo 和已部署的 Sites 页面跨域访问。
- Codex 外部任务默认使用 `approvalPolicy: never`。
- 可选择“只读”或“工作区写入、禁用网络”两种执行模式。
- 外部任务 ID 在 Companion 生命周期内保持幂等。

可通过环境变量覆盖配置：

```bash
DISPATCHER_PORT=5126 \
DISPATCHER_TOKEN="your-local-token" \
DISPATCHER_ALLOWED_ORIGINS="http://localhost:3000" \
npm run companion
```

## 构建

```bash
npm run build
npm test
```
