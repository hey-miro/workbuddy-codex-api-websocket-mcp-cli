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
};

const seedTasks: Task[] = [
  { id: "WB-1042", externalId: "monitor-0826-03", capability: "notification_send", title: "项目风险提醒", body: "支付服务错误率在 10 分钟内超过阈值。", priority: "high", status: "completed", createdAt: "10:42" },
  { id: "WB-1041", externalId: "mail-0826-18", capability: "send_message", title: "客户邮件需要处理", body: "请分析邮件并生成回复建议。", priority: "normal", status: "running", createdAt: "10:38" },
  { id: "WB-1040", externalId: "cron-0826-07", capability: "notification_send", title: "日报已生成", body: "今天的团队日报已整理完成。", priority: "low", status: "completed", createdAt: "10:31" },
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
      try { setTasks(JSON.parse(stored)); } catch { /* keep demo data */ }
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
    const task: Task = {
      id: `WB-${1040 + tasks.length + 1}`,
      externalId,
      capability: String(data.get("capability")),
      title: String(data.get("title")),
      body: String(data.get("body")),
      priority: String(data.get("priority")),
      status: "queued",
      createdAt: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
    setTasks((current) => [task, ...current]);
    setSelected(task);
    setNotice(`任务 ${task.id} 已进入队列`);
    event.currentTarget.reset();
    window.setTimeout(() => {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "running" } : item));
      setSelected((current) => current?.id === task.id ? { ...current, status: "running" } : current);
      setNotice(`WorkBuddy 正在执行 ${task.capability}`);
    }, 700);
    window.setTimeout(() => {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "completed" } : item));
      setSelected((current) => current?.id === task.id ? { ...current, status: "completed" } : current);
      setNotice(`任务 ${task.id} 执行完成，结果已保存`);
    }, 2200);
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
          <article><span>执行成功</span><strong>{counts.done}</strong><small className="green">幂等保护已启用</small></article>
        </section>

        <div className="main-grid">
          <section className="panel composer">
            <div className="panel-title"><div><span className="eyebrow">NEW TASK</span><h2>创建测试任务</h2></div><span className="method">POST /tasks</span></div>
            <form onSubmit={submitTask}>
              <label>外部任务 ID<input name="externalId" required defaultValue={`demo-${Date.now().toString().slice(-5)}`} /></label>
              <div className="field-row">
                <label>WorkBuddy 能力<select name="capability" defaultValue="notification_send"><option>notification_send</option><option>send_message</option><option>conversation_create</option></select></label>
                <label>优先级<select name="priority" defaultValue="normal"><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
              </div>
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
                  <span className="task-copy"><strong>{task.title}</strong><small>{task.id} · {task.capability}</small></span>
                  <span className={`badge ${task.status}`}>{statusLabel[task.status]}</span>
                  <time>{task.createdAt}</time>
                </button>
              ))}
            </div>
          </section>
        </div>

        {selected && <section className="detail-panel">
          <div><span className="eyebrow">SELECTED TASK</span><h3>{selected.title}</h3><p>{selected.body}</p></div>
          <dl><div><dt>外部 ID</dt><dd>{selected.externalId}</dd></div><div><dt>能力</dt><dd>{selected.capability}</dd></div><div><dt>状态</dt><dd>{statusLabel[selected.status]}</dd></div><div><dt>优先级</dt><dd>{selected.priority}</dd></div></dl>
        </section>}
      </section>
    </main>
  );
}
