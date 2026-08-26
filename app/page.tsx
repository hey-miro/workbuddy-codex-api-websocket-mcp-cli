"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type TaskStatus = "queued" | "running" | "completed" | "failed";
type Task = {
  id: string;
  externalId: string;
  capability: string;
  title: string;
  body: string;
  priority: string;
  status: TaskStatus;
  createdAt: string;
  sessionId: string;
  sessionAlias: string;
  reuseSession: boolean;
};

const sessions = [
  { id: "wb-session-project-a", alias: "项目监控会话", state: "在线", tone: "online" },
  { id: "wb-session-mail-agent", alias: "邮件处理会话", state: "忙碌", tone: "busy" },
  { id: "wb-session-daily", alias: "日常任务会话", state: "在线", tone: "online" },
];

const seedTasks: Task[] = [
  { id: "WB-1042", externalId: "monitor-0826-03", capability: "conversation_send", title: "项目风险提醒", body: "支付服务错误率在 10 分钟内超过阈值。", priority: "high", status: "completed", createdAt: "10:42", sessionId: sessions[0].id, sessionAlias: sessions[0].alias, reuseSession: true },
  { id: "WB-1041", externalId: "mail-0826-18", capability: "conversation_send", title: "客户邮件需要处理", body: "请分析邮件并生成回复建议。", priority: "normal", status: "running", createdAt: "10:38", sessionId: sessions[1].id, sessionAlias: sessions[1].alias, reuseSession: true },
  { id: "WB-1040", externalId: "cron-0826-07", capability: "conversation_send", title: "日报已生成", body: "今天的团队日报已整理完成。", priority: "low", status: "completed", createdAt: "10:31", sessionId: sessions[2].id, sessionAlias: sessions[2].alias, reuseSession: true },
];

const statusLabel: Record<TaskStatus, string> = {
  queued: "等待中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [selected, setSelected] = useState<Task | null>(seedTasks[0]);
  const [connection, setConnection] = useState<"mock" | "live">("mock");
  const [notice, setNotice] = useState("模拟网关已连接，可立即测试");

  useEffect(() => {
    const stored = window.localStorage.getItem("workbuddy-demo-tasks");
    if (stored) {
      try {
        const restored = JSON.parse(stored) as Task[];
        setTasks(restored.map((task) => ({
          ...task,
          sessionId: task.sessionId || sessions[0].id,
          sessionAlias: task.sessionAlias || sessions[0].alias,
          reuseSession: task.reuseSession ?? true,
        })));
      } catch { /* keep demo data */ }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("workbuddy-demo-tasks", JSON.stringify(tasks));
  }, [tasks]);

  const counts = useMemo(() => ({
    total: tasks.length,
    active: tasks.filter((t) => t.status === "running" || t.status === "queued").length,
    done: tasks.filter((t) => t.status === "completed").length,
  }), [tasks]);

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const externalId = String(data.get("externalId") || "");
    if (tasks.some((task) => task.externalId === externalId)) {
      setNotice(`已拦截重复任务：${externalId}`);
      return;
    }
    const now = new Date();
    const sessionId = String(data.get("sessionId"));
    const targetSession = sessions.find((session) => session.id === sessionId);
    const reuseSession = data.get("reuseSession") === "on";
    if (reuseSession && !targetSession) {
      setNotice("投递失败：要求复用的原会话不存在，未自动新建会话");
      return;
    }
    const task: Task = {
      id: `WB-${1040 + tasks.length + 1}`,
      externalId,
      capability: String(data.get("capability")),
      title: String(data.get("title")),
      body: String(data.get("body")),
      priority: String(data.get("priority")),
      status: "queued",
      createdAt: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      sessionId,
      sessionAlias: targetSession?.alias || "未绑定会话",
      reuseSession,
    };
    setTasks((current) => [task, ...current]);
    setSelected(task);
    const isBusy = targetSession?.tone === "busy";
    setNotice(isBusy ? `${targetSession.alias}当前忙碌，任务已进入该会话专属队列` : `任务 ${task.id} 已投递到原会话：${task.sessionAlias}`);
    window.setTimeout(() => {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "running" } : item));
      setSelected((current) => current?.id === task.id ? { ...current, status: "running" } : current);
      setNotice(`已唤醒 ${task.sessionAlias}，WorkBuddy 正在原会话中继续执行`);
    }, isBusy ? 1600 : 700);
    window.setTimeout(() => {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "completed" } : item));
      setSelected((current) => current?.id === task.id ? { ...current, status: "completed" } : current);
      setNotice(`任务 ${task.id} 已在 ${task.sessionAlias} 中执行完成`);
    }, isBusy ? 3400 : 2200);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>WorkBuddy</strong><small>Dispatcher</small></div></div>
        <nav>
          <button className="nav-item active"><span>⌁</span>任务中心<em>{counts.active}</em></button>
          <button className="nav-item"><span>◇</span>能力目录</button>
          <button className="nav-item"><span>↯</span>事件日志</button>
          <button className="nav-item"><span>⚙</span>连接设置</button>
        </nav>
        <div className="gateway-card">
          <div className="gateway-head"><span className="pulse" />Gateway 状态</div>
          <strong>{connection === "mock" ? "模拟模式" : "实时模式"}</strong>
          <p>{connection === "mock" ? "无需安装 WorkBuddy 即可体验完整流程。" : "连接 localhost:5126"}</p>
          <button onClick={() => { setConnection(connection === "mock" ? "live" : "mock"); setNotice(connection === "mock" ? "已切换到实时模式；请配置本地 MCP Gateway" : "已切回模拟模式"); }}>
            切换到{connection === "mock" ? "实时" : "模拟"}模式
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>本地任务分发器</p><h1>把外部任务交给 WorkBuddy</h1></div>
          <div className="connection-pill"><span />127.0.0.1 · 已连接</div>
        </header>

        <div className="notice"><span>✓</span>{notice}</div>

        <section className="stats">
          <article><span>今日任务</span><strong>{counts.total}</strong><small>本机持久化</small></article>
          <article><span>正在处理</span><strong>{counts.active}</strong><small className="amber">队列工作正常</small></article>
          <article><span>已绑定会话</span><strong>{sessions.length}</strong><small className="green">原会话续接已启用</small></article>
        </section>

        <section className="session-strip">
          <div className="session-strip-title"><span className="eyebrow">SESSION ROUTING</span><strong>会话路由</strong></div>
          {sessions.map((session) => <div className="session-chip" key={session.id}><span className={session.tone} /><div><strong>{session.alias}</strong><small>{session.id}</small></div><em>{session.state}</em></div>)}
        </section>

        <div className="main-grid">
          <section className="panel composer">
            <div className="panel-title"><div><span className="eyebrow">NEW TASK</span><h2>创建测试任务</h2></div><span className="method">POST /tasks</span></div>
            <form onSubmit={submitTask}>
              <label>外部任务 ID<input name="externalId" required defaultValue={`demo-${Date.now().toString().slice(-5)}`} /></label>
              <div className="field-row">
                <label>投递方式<select name="capability" defaultValue="conversation_send"><option>conversation_send</option><option>send_message</option><option>notification_send</option></select></label>
                <label>优先级<select name="priority" defaultValue="normal"><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
              </div>
              <label>目标原会话<select name="sessionId" defaultValue={sessions[0].id}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.alias} · {session.state}</option>)}</select></label>
              <label className="switch-row"><span><strong>必须复用原会话</strong><small>找不到目标会话时失败，不自动新建</small></span><input type="checkbox" name="reuseSession" defaultChecked /></label>
              <label>标题<input name="title" required placeholder="例如：发现一个新任务" /></label>
              <label>任务内容<textarea name="body" required rows={4} placeholder="描述希望 WorkBuddy 执行的内容……" /></label>
              <button className="primary" type="submit"><span>▶</span>发送给 WorkBuddy</button>
            </form>
          </section>

          <section className="panel queue-panel">
            <div className="panel-title"><div><span className="eyebrow">TASK QUEUE</span><h2>最近任务</h2></div><button className="text-button" onClick={() => setTasks(seedTasks)}>重置</button></div>
            <div className="task-list">
              {tasks.map((task) => (
                <button key={task.id} className={`task-row ${selected?.id === task.id ? "selected" : ""}`} onClick={() => setSelected(task)}>
                  <span className={`status-dot ${task.status}`} />
                  <span className="task-copy"><strong>{task.title}</strong><small>{task.id} · {task.sessionAlias}</small></span>
                  <span className={`badge ${task.status}`}>{statusLabel[task.status]}</span>
                  <time>{task.createdAt}</time>
                </button>
              ))}
            </div>
          </section>
        </div>

        {selected && <section className="detail-panel">
          <div><span className="eyebrow">SELECTED TASK</span><h3>{selected.title}</h3><p>{selected.body}</p></div>
          <dl><div><dt>原会话</dt><dd>{selected.sessionAlias}</dd></div><div><dt>Session ID</dt><dd>{selected.sessionId}</dd></div><div><dt>状态</dt><dd>{statusLabel[selected.status]}</dd></div><div><dt>续接策略</dt><dd>{selected.reuseSession ? "必须复用" : "允许新建"}</dd></div></dl>
        </section>}
      </section>
    </main>
  );
}
