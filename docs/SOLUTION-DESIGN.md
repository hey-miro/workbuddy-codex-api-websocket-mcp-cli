# WorkBuddy 与 Codex 原会话任务注入方案设计

## 1. 背景与目标

业务系统发现新任务后，需要主动唤醒用户电脑上的 WorkBuddy 或 Codex Desktop，并让 Agent 在一个**已经存在的原会话**里继续执行，而不是创建新会话，也不是要求用户手动复制任务。

本方案的目标是：

- 外部系统可以按会话 ID 精确投递任务。
- 新消息和执行结果保留在原会话上下文中。
- WorkBuddy 与 Codex 使用统一的业务调度接口。
- 桌面应用的本地协议由本机组件隔离，避免直接暴露到公网。
- 支持幂等、防重复、状态跟踪和最小权限执行。

## 2. 总体架构

```text
任务来源
Webhook / 消息队列 / 定时扫描 / 业务数据库
                    |
                    v
             中央任务调度器
       路由、幂等、重试、状态与结果存储
                    |
          HTTPS / WebSocket / 长轮询
                    v
             本机 Companion
          身份验证、协议适配、安全控制
             /                 \
            v                   v
   WorkBuddy Adapter       Codex Adapter
   Session Registry        Codex App Server
   + Local ACP             JSON-RPC / stdio
            |                   |
            v                   v
    WorkBuddy 原会话        Codex 原任务
```

中央调度器不直接操作桌面应用。每台安装桌面 Agent 的电脑运行一个轻量 Companion，由 Companion 主动连接中央调度器并在本机调用对应协议。这样可以穿过 NAT，同时把 WorkBuddy 和 Codex 的本地接口限制在用户电脑内。

## 3. 两个平台分别使用的技术

| 设计项 | WorkBuddy | Codex Desktop |
| --- | --- | --- |
| 本地接入技术 | 本地 ACP 会话接口 | 官方 Codex App Server |
| 协议形态 | 本地 HTTP，ACP 消息注入 | JSON-RPC over stdio |
| 会话发现 | 读取本机会话注册信息，例如 `~/.workbuddy/app/sessions.json` | 调用 `thread/list` |
| 原会话恢复 | 根据会话记录定位本地 ACP 目标 | 调用 `thread/resume` |
| 消息注入 | 向本地 `/api/v1/acp` 投递 ACP 消息 | 调用 `turn/start`，输入文本消息 |
| 执行状态 | ACP 响应、会话状态或回调 | `turn/*`、`item/*` 通知 |
| 忙碌处理 | ACP 侧排队或 Companion 重试 | 由 App Server 接受、拒绝或等待后重试 |
| 当前 Demo 状态 | ACP 链路已验证，网页端仍是流程模拟 | 已接真实 App Server，可选择真实原任务并执行 |

### 3.1 WorkBuddy：会话注册信息 + 本地 ACP

WorkBuddy 方案使用两个本地能力：

1. **会话发现**：从 WorkBuddy 本地会话注册信息中获得会话 ID、状态和本地 ACP 连接参数。
2. **消息注入**：向 WorkBuddy 本地 `/api/v1/acp` 端点发送 ACP 消息，让指定会话追加一轮用户指令。

WorkBuddy Adapter 负责把统一任务转换为 ACP 所需消息，并处理会话繁忙、会话失效和本地端口变化。会话文件只应在本机读取，中央调度器不保存其文件路径或本地访问凭据。

WorkBuddy 调用时序：

```text
外部任务到达
    -> 调度器确定设备和业务会话
    -> 本机 Companion 刷新 WorkBuddy 会话注册信息
    -> 根据映射找到目标 sessionId
    -> WorkBuddy Adapter 调用本地 ACP
    -> 消息出现在原会话
    -> 收集执行状态与回复
    -> 回传中央调度器
```

### 3.2 Codex：官方 App Server + JSON-RPC

Codex 方案不读取内部数据库或模拟界面点击，而是启动桌面应用自带的命令：

```text
codex app-server --stdio
```

Codex Adapter 通过标准输入输出交换逐行 JSON-RPC 消息：

1. 使用 `thread/list` 读取已有任务。
2. 使用 `thread/resume` 恢复目标任务上下文。
3. 使用 `turn/start` 在原任务中追加新指令并启动执行。
4. 监听 `turn/started`、`item/agentMessage/delta` 和 `turn/completed` 获取状态与回复。

Codex 调用时序：

```text
外部任务到达
    -> 调度器确定设备和目标 threadId
    -> 本机 Companion 连接 Codex App Server
    -> thread/resume 恢复原任务
    -> turn/start 注入消息并执行
    -> turn/item 通知更新执行状态和回复
    -> 回传中央调度器
```

当前 Codex Demo 已使用这条真实链路完成验证：消息被注入既有任务，目标任务在原历史后追加一轮并正常回复，没有创建新任务。

## 4. 统一调度模型

虽然底层协议不同，业务系统只需要面对一套任务模型：

```json
{
  "externalId": "order-20260826-001",
  "agent": "codex",
  "deviceId": "macbook-miro",
  "conversationId": "existing-conversation-id",
  "prompt": "请继续处理这个任务",
  "executionMode": "readOnly"
}
```

核心字段：

- `externalId`：业务侧唯一任务 ID，用于幂等。
- `agent`：`workbuddy` 或 `codex`。
- `deviceId`：目标桌面设备。
- `conversationId`：业务系统保存的逻辑会话 ID，由 Companion 映射为 WorkBuddy `sessionId` 或 Codex `threadId`。
- `prompt`：需要追加到原会话的指令。
- `executionMode`：允许的执行权限。

建议维护两层映射：

```text
业务对象 ID -> 逻辑会话 ID
逻辑会话 ID + Agent + 设备 ID -> 本地 sessionId / threadId
```

这样在桌面应用会话迁移、设备更换或本地 ID 失效时，不需要修改业务数据。

## 5. Companion 设计

Companion 是整个方案的关键边界，建议拆为以下模块：

- **连接管理器**：主动连接中央调度器，保持心跳并接收任务。
- **认证模块**：校验设备身份、任务签名和允许的来源。
- **会话目录**：定期同步可用 WorkBuddy 会话和 Codex 任务。
- **WorkBuddy Adapter**：负责本地会话注册信息和 ACP 协议。
- **Codex Adapter**：负责 Codex App Server 生命周期和 JSON-RPC。
- **任务执行器**：处理幂等、排队、超时、取消和重试。
- **结果上报器**：以事件方式上报状态、回复和错误。

两个 Adapter 对上层实现相同接口：

```text
listConversations()
resumeConversation(conversationId)
dispatch(conversationId, prompt, policy)
getTaskStatus(taskId)
cancelTask(taskId)
```

## 6. 任务状态设计

建议统一为：

```text
received -> queued -> dispatching -> running -> completed
                                  \-> failed
                                  \-> cancelled
```

平台自身状态只在 Adapter 内转换：

- WorkBuddy 的 ACP 状态映射到统一状态。
- Codex 的 `turn/started` 映射为 `running`，`turn/completed` 映射为 `completed` 或 `failed`。

中央调度器持久化每次状态变化。Companion 即使重启，也能根据未完成任务重新核对状态，而不是依赖内存记录。

## 7. 安全设计

- Companion 主动连接中央服务，不在用户电脑上开放公网端口。
- WorkBuddy ACP 和 Codex App Server 只允许本机进程访问。
- 每台设备使用独立设备凭据，中央服务按用户和设备授权。
- 指令携带不可重复的 `externalId`、时间戳和签名，防止重放。
- 默认使用只读执行；需要写入时只开放当前会话工作目录。
- Codex 外部任务使用 `approvalPolicy: never`，不能通过无人值守任务临时扩大权限。
- Token、会话文件、本地端口和桌面应用内部信息不得写入日志或上传仓库。
- 对提示词长度、任务频率、并发数和执行时长设置限制。

## 8. 异常与恢复

| 场景 | 处理策略 |
| --- | --- |
| 目标设备离线 | 中央调度器保留任务，设备重新上线后投递 |
| 会话 ID 失效 | Companion 刷新会话目录，标记映射失效并通知用户重新绑定 |
| 原会话正在执行 | 本地排队；不支持排队时使用指数退避重试 |
| 重复 Webhook | 使用 `externalId` 返回原任务记录，不再次注入 |
| Companion 重启 | 从中央调度器领取未完成任务并重新核对 |
| 桌面应用升级导致协议变化 | Adapter 做版本检测；不影响统一调度接口 |
| 执行超时 | 标记超时，保留原任务 ID 和平台执行 ID 供人工检查 |

## 9. 为什么不让 Codex 在会话里一直轮询

让一个对话持续轮询外部任务虽然可以做概念验证，但不适合作为正式方案：

- 会话或桌面应用关闭后轮询立即失效。
- 持续占用模型执行时间和额度。
- 难以保证幂等、重试和任务顺序。
- 无法可靠监控进程健康状态。
- 轮询频率在延迟和成本之间存在冲突。

正式方案应由轻量 Companion 负责常驻连接和任务队列，只有发现任务时才调用 WorkBuddy 或 Codex。

## 10. 落地阶段

### 阶段一：单机验证

- Codex 接入真实 App Server，完成原任务注入和结果读取。
- WorkBuddy 验证本地会话发现和 ACP 消息注入。
- 使用本地 Demo 页面人工选择会话并发送任务。

### 阶段二：统一 Companion

- 抽象 WorkBuddy/Codex Adapter。
- 引入持久化任务队列和会话映射。
- 实现设备认证、心跳、断线重连和幂等。

### 阶段三：外部业务接入

- 提供 Webhook 或消息队列入口。
- 建立业务对象到 Agent 会话的绑定关系。
- 增加任务状态页、审计记录和失败重试。

### 阶段四：生产化

- 代码签名和自动更新 Companion。
- 加密设备凭据和本地敏感配置。
- 加入权限策略、并发限制、可观测性和告警。
- 对 WorkBuddy/Codex 新版本执行兼容性测试。

## 11. 推荐结论

推荐采用“**中央调度器 + 本机 Companion + 双 Adapter**”架构：

- WorkBuddy Adapter 使用本地会话注册信息与 ACP 注入。
- Codex Adapter 使用官方 App Server 的 `thread/resume + turn/start`。
- 中央系统只处理统一任务模型，不感知桌面应用的协议细节。

这一方案比让 Agent 会话长期轮询更稳定，也能确保任务进入指定的原会话。当前 Demo 可作为单机验证基础；下一步应把 WorkBuddy Adapter 接入 Companion，并把内存任务状态迁移到持久化队列。
