"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Platform = "codex" | "workbuddy";
type ConnectionState = "checking" | "offline" | "unauthorized" | "online";
type TaskStatus = "starting" | "accepted" | "queued" | "running" | "completed" | "failed";

type CodexThread = {
  id: string;
  name: string;
  preview: string;
  status: string;
  cwd: string;
  updatedAt: string | null;
  source: string | null;
};

type DispatchTask = {
  id: string;
  externalId: string;
  platform: Platform;
  threadId: string;
  threadName: string;
  title: string;
  prompt: string;
  executionMode: "readOnly" | "workspaceWrite";
  status: TaskStatus;
  reply?: string;
  error?: string | null;
  createdAt: string;
};

const COMPANION_URL = "http://127.0.0.1:5126";

const workbuddySessions = [
  { id: "2079081973863743488", name: "获取其他电脑的会话信息", status: "已验证" },
  { id: "wb-session-mail-agent", name: "邮件处理会话", status: "演示" },
];

const seedTasks: DispatchTask[] = [
  {
    id: "demo-codex-1",
    externalId: "codex-demo-0826",
    platform: "codex",
    threadId: "等待 Companion 读取",
    threadName: "Codex 原任务",
    title: "代码仓库健康检查",
    prompt: "检查当前仓库状态并给出风险摘要。",
    executionMode: "readOnly",
    status: "completed",
    createdAt: "10:46",
  },
  {
    id: "demo-workbuddy-1",
    externalId: "workbuddy-proof-0826",
    platform: "workbuddy",
    threadId: "2079081973863743488",
    threadName: "获取其他电脑的会话信息",
    title: "外部系统注入验证",
    prompt: "外部系统注入测试：请只回复连接成功。",
    executionMode: "readOnly",
    status: "completed",
    createdAt: "10:41",
  },
];

const statusText: Record<TaskStatus, string> = {
  starting: "启动中",
  accepted: "已接收",
  queued: "等待中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
};

function clock(value = new Date()) {
  return value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function Home() {
  const [platform, setPlatform] = useState<Platform>("codex");
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [token, setToken] = useState("");
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [tasks, setTasks] = useState<DispatchTask[]>(seedTasks);
  const [selectedTaskId, setSelectedTaskId] = useState(seedTasks[0].id);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [notice, setNotice] = useState("正在检查本机 Companion…");
  const [loadingThreads, setLoadingThreads] = useState(false);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) || null;

  const companionHeaders = useCallback((json = false) => {
    const headers: Record<string, string> = { "X-Dispatcher-Token": token };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }, [token]);

  const refreshThreads = useCallback(async (quiet = false) => {
    if (!token) {
      setConnection("unauthorized");
      setNotice("Companion 已发现，请输入启动窗口中显示的 Token");
      return;
    }
    if (!quiet) setLoadingThreads(true);
    try {
      const response = await fetch(`${COMPANION_URL}/api/codex/threads`, {
        headers: companionHeaders(),
      });
      const data = await response.json();
      if (response.status === 401) {
        setConnection("unauthorized");
        setNotice("Token 不正确，请复制 Companion 启动窗口中的最新 Token");
        return;
      }
      if (!response.ok) throw new Error(data.error || "读取 Codex 任务失败");
      setThreads(data.threads || []);
      setSelectedThreadId((current) => current || data.threads?.[0]?.id || "");
      setConnection("online");
      setNotice(`已连接 Codex App Server，发现 ${data.threads?.length || 0} 个原任务`);
    } catch (error) {
      setConnection("offline");
      setNotice(error instanceof Error ? error.message : "无法连接本机 Companion");
    } finally {
      setLoadingThreads(false);
    }
  }, [companionHeaders, token]);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(`${COMPANION_URL}/health`, {
        headers: token ? companionHeaders() : undefined,
      });
      const data = await response.json();
      if (!response.ok || !data.codexConnected) throw new Error(data.error || "Codex App Server 未就绪");
      if (!token || !data.authenticated) {
        setConnection("unauthorized");
        setNotice("本机 Companion 已运行；输入 Token 后即可读取 Codex 原任务");
        return;
      }
      await refreshThreads(true);
    } catch {
      setConnection("offline");
      setNotice("未发现本机 Companion，请先运行 npm run companion");
    }
  }, [companionHeaders, refreshThreads, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setToken(window.localStorage.getItem("desktop-dispatcher-token") || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (connection !== "checking") return;
    const timer = window.setTimeout(() => void checkHealth(), 50);
    return () => window.clearTimeout(timer);
  }, [checkHealth, connection, token]);

  const counts = useMemo(() => ({
    total: tasks.length,
    active: tasks.filter((task) => ["starting", "accepted", "queued", "running"].includes(task.status)).length,
    completed: tasks.filter((task) => task.status === "completed").length,
  }), [tasks]);

  function saveToken() {
    window.localStorage.setItem("desktop-dispatcher-token", token);
    setConnection("checking");
    setNotice("正在验证 Companion Token…");
    void checkHealth();
  }

  async function pollTask(taskId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const response = await fetch(`${COMPANION_URL}/api/tasks/${encodeURIComponent(taskId)}`, {
          headers: companionHeaders(),
        });
        if (!response.ok) return;
        const data = await response.json();
        const remote = data.task;
        setTasks((current) => current.map((task) => task.id === taskId ? {
          ...task,
          status: remote.status,
          reply: remote.reply,
          error: remote.error,
        } : task));
        if (remote.status === "completed" || remote.status === "failed") {
          setNotice(remote.status === "completed" ? "Codex 已在原任务中执行完成" : `Codex 执行失败：${remote.error || "未知错误"}`);
          return;
        }
      } catch {
        return;
      }
    }
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const externalId = String(form.get("externalId") || "").trim();
    const title = String(form.get("title") || "").trim();
    const prompt = String(form.get("prompt") || "").trim();
    const executionMode = form.get("executionMode") === "readOnly" ? "readOnly" : "workspaceWrite";

    if (tasks.some((task) => task.externalId === externalId)) {
      setNotice(`已拦截重复任务：${externalId}`);
      return;
    }

    if (platform === "workbuddy") {
      const threadId = String(form.get("workbuddySessionId") || "");
      const session = workbuddySessions.find((item) => item.id === threadId);
      const demoTask: DispatchTask = {
        id: `wb-demo-${Date.now()}`,
        externalId,
        platform,
        threadId,
        threadName: session?.name || "WorkBuddy 会话",
        title,
        prompt,
        executionMode,
        status: "queued",
        createdAt: clock(),
      };
      setTasks((current) => [demoTask, ...current]);
      setSelectedTaskId(demoTask.id);
      setNotice("WorkBuddy 链路已验证；当前网页仍为演示投递，Codex 已切换为真实调用");
      return;
    }

    if (connection !== "online" || !selectedThread) {
      setNotice("请先连接本机 Companion 并选择一个 Codex 原任务");
      return;
    }

    const optimisticTask: DispatchTask = {
      id: `pending-${Date.now()}`,
      externalId,
      platform,
      threadId: selectedThread.id,
      threadName: selectedThread.name,
      title,
      prompt,
      executionMode,
      status: "starting",
      createdAt: clock(),
    };
    setTasks((current) => [optimisticTask, ...current]);
    setSelectedTaskId(optimisticTask.id);
    setNotice(`正在续接 Codex 原任务：${selectedThread.name}`);

    try {
      const response = await fetch(`${COMPANION_URL}/api/codex/dispatch`, {
        method: "POST",
        headers: companionHeaders(true),
        body: JSON.stringify({ externalId, threadId: selectedThread.id, prompt, executionMode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "投递失败");
      const remote = data.task;
      const accepted: DispatchTask = {
        ...optimisticTask,
        id: remote.id,
        status: remote.status,
        reply: remote.reply,
        error: remote.error,
      };
      setTasks((current) => current.map((task) => task.id === optimisticTask.id ? accepted : task));
      setSelectedTaskId(remote.id);
      setNotice(data.duplicate ? "重复任务已安全返回原执行记录" : `已在原任务中启动 Codex，Turn ID：${remote.turnId || "等待中"}`);
      void pollTask(remote.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "投递失败";
      setTasks((current) => current.map((task) => task.id === optimisticTask.id ? { ...task, status: "failed", error: message } : task));
      setNotice(message);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">D</span><div><strong>Desktop Agent</strong><small>Dispatcher</small></div></div>
        <nav aria-label="主要导航">
          <button className="nav-item active"><span>⌁</span>任务中心<em>{counts.active}</em></button>
          <button className="nav-item"><span>◇</span>Agent 通道</button>
          <button className="nav-item"><span>↯</span>执行记录</button>
          <button className="nav-item"><span>⚙</span>安全设置</button>
        </nav>

        <section className="companion-card">
          <div className="gateway-head"><span className={`pulse ${connection}`} />本机 Companion</div>
          <strong>{connection === "online" ? "真实连接" : connection === "unauthorized" ? "等待 Token" : connection === "checking" ? "检查中" : "未运行"}</strong>
          <code>127.0.0.1:5126</code>
          <label>Companion Token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="粘贴启动窗口中的 Token" /></label>
          <button onClick={saveToken}>连接并读取 Codex 任务</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>原会话任务分发器</p><h1>让外部系统唤醒桌面 Agent</h1></div>
          <div className={`connection-pill ${connection}`}><span />{connection === "online" ? "Codex App Server · 已连接" : "本机 Companion · 未连接"}</div>
        </header>

        <div className={`notice ${connection === "offline" ? "warning" : ""}`}><span>{connection === "offline" ? "!" : "✓"}</span>{notice}</div>

        <div className="platform-tabs" role="tablist" aria-label="Agent 平台">
          <button role="tab" aria-selected={platform === "codex"} className={platform === "codex" ? "active" : ""} onClick={() => setPlatform("codex")}><b>C</b><span><strong>Codex Desktop</strong><small>官方 App Server · 真实调用</small></span><em className="live-tag">LIVE</em></button>
          <button role="tab" aria-selected={platform === "workbuddy"} className={platform === "workbuddy" ? "active" : ""} onClick={() => setPlatform("workbuddy")}><b>W</b><span><strong>WorkBuddy</strong><small>ACP 注入 · 已验证链路</small></span><em>DEMO</em></button>
        </div>

        <section className="stats">
          <article><span>任务总数</span><strong>{counts.total}</strong><small>外部 ID 去重</small></article>
          <article><span>正在执行</span><strong>{counts.active}</strong><small className="amber">实时状态同步</small></article>
          <article><span>Codex 原任务</span><strong>{threads.length}</strong><small className="green">{connection === "online" ? "来自本机真实数据" : "连接后自动读取"}</small></article>
        </section>

        <section className="thread-panel">
          <div className="thread-panel-title"><div><span className="eyebrow">ORIGINAL THREADS</span><h2>{platform === "codex" ? "选择 Codex 原任务" : "选择 WorkBuddy 原会话"}</h2></div>{platform === "codex" && <button className="text-button" disabled={loadingThreads} onClick={() => void refreshThreads()}>{loadingThreads ? "读取中…" : "刷新任务"}</button>}</div>
          <div className="thread-list">
            {platform === "codex" ? (
              threads.length ? threads.map((thread) => <button key={thread.id} className={`thread-card ${selectedThreadId === thread.id ? "selected" : ""}`} onClick={() => setSelectedThreadId(thread.id)}><span className="thread-state" /><div><strong>{thread.name}</strong><small>{thread.preview || thread.cwd}</small><code>{thread.id}</code></div><em>{thread.status}</em></button>) : <div className="empty-state"><strong>尚未读取到 Codex 任务</strong><span>启动 Companion、填写 Token，然后点击“刷新任务”。</span></div>
            ) : workbuddySessions.map((session) => <div className="thread-card" key={session.id}><span className="thread-state workbuddy" /><div><strong>{session.name}</strong><small>WorkBuddy 项目原会话</small><code>{session.id}</code></div><em>{session.status}</em></div>)}
          </div>
        </section>

        <div className="main-grid">
          <section className="panel composer">
            <div className="panel-title"><div><span className="eyebrow">EXTERNAL DISPATCH</span><h2>创建外部任务</h2></div><span className="method">POST /dispatch</span></div>
            <form onSubmit={submitTask}>
              <label>外部任务 ID<input name="externalId" required defaultValue="external-task-001" /></label>
              {platform === "workbuddy" && <label>目标 WorkBuddy 会话<select name="workbuddySessionId" defaultValue={workbuddySessions[0].id}>{workbuddySessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>}
              <div className="field-row"><label>执行模式<select name="executionMode" defaultValue="workspaceWrite"><option value="workspaceWrite">工作区写入（无网络）</option><option value="readOnly">只读分析</option></select></label><label>策略<input value="必须复用原任务" readOnly /></label></div>
              <label>任务标题<input name="title" required placeholder="例如：检查构建失败原因" /></label>
              <label>发送给 Agent 的指令<textarea name="prompt" required rows={5} placeholder={platform === "codex" ? "描述希望 Codex 在原任务中继续执行的工作……" : "描述希望 WorkBuddy 执行的内容……"} /></label>
              <button className="primary" type="submit" disabled={platform === "codex" && connection !== "online"}><span>▶</span>{platform === "codex" ? "发送到 Codex 原任务" : "演示 WorkBuddy 投递"}</button>
            </form>
          </section>

          <section className="panel queue-panel">
            <div className="panel-title"><div><span className="eyebrow">DISPATCH HISTORY</span><h2>最近任务</h2></div><button className="text-button" onClick={() => setTasks(seedTasks)}>重置演示记录</button></div>
            <div className="task-list">
              {tasks.map((task) => <button key={task.id} className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`} onClick={() => setSelectedTaskId(task.id)}><span className={`agent-logo ${task.platform}`}>{task.platform === "codex" ? "C" : "W"}</span><span className="task-copy"><strong>{task.title}</strong><small>{task.threadName} · {task.externalId}</small></span><span className={`badge ${task.status}`}>{statusText[task.status]}</span><time>{task.createdAt}</time></button>)}
            </div>
          </section>
        </div>

        {selectedTask && <section className="detail-panel"><div><span className="eyebrow">SELECTED TASK</span><h3>{selectedTask.title}</h3><p>{selectedTask.error || selectedTask.reply || selectedTask.prompt}</p></div><dl><div><dt>Agent</dt><dd>{selectedTask.platform === "codex" ? "Codex Desktop" : "WorkBuddy"}</dd></div><div><dt>原任务</dt><dd>{selectedTask.threadName}</dd></div><div><dt>状态</dt><dd>{statusText[selectedTask.status]}</dd></div><div><dt>安全模式</dt><dd>{selectedTask.executionMode === "readOnly" ? "只读" : "工作区写入 / 无网络"}</dd></div></dl></section>}

        <section className="architecture"><span>外部系统</span><i>→</i><span>本机 Companion</span><i>→</i><span>Codex App Server</span><i>→</i><span>原任务继续执行</span></section>
      </section>
    </main>
  );
}
