import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { CodexAppServerClient } from "./app-server-client.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DISPATCHER_PORT || 5126);
const TOKEN = process.env.DISPATCHER_TOKEN || randomBytes(18).toString("base64url");
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://workbuddy-dispatcher-demo.lively-degu-4351.chatgpt.site",
];
const ALLOWED_ORIGINS = new Set(
  (process.env.DISPATCHER_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const codex = new CodexAppServerClient();
const tasks = new Map();
const idempotency = new Map();

codex.onNotification((message) => {
  const params = message.params || {};
  const threadId = params.threadId || params.turn?.threadId;
  const turnId = params.turnId || params.turn?.id;
  for (const task of tasks.values()) {
    if (task.threadId !== threadId || (turnId && task.turnId !== turnId)) continue;
    if (message.method === "turn/started") task.status = "running";
    if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      task.reply = `${task.reply || ""}${params.delta}`;
    }
    if (message.method === "turn/completed") {
      const status = params.turn?.status;
      task.status = status === "completed" ? "completed" : "failed";
      task.error = params.turn?.error?.message || null;
      task.completedAt = new Date().toISOString();
    }
  }
});

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Dispatcher-Token");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function isAuthorized(request) {
  return request.headers["x-dispatcher-token"] === TOKEN;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicThread(thread) {
  return {
    id: thread.id,
    name: thread.name || "未命名任务",
    preview: thread.preview || "",
    status: thread.status?.type || thread.status || "unknown",
    cwd: thread.cwd || "",
    updatedAt: thread.updatedAt || thread.createdAt || null,
    source: thread.source || null,
  };
}

async function handle(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    try {
      await codex.start();
      json(response, 200, {
        ok: true,
        service: "desktop-agent-dispatcher-companion",
        codexConnected: codex.connected,
        authenticated: isAuthorized(request),
      });
    } catch (error) {
      json(response, 503, { ok: false, codexConnected: false, error: error.message });
    }
    return;
  }

  if (!isAuthorized(request)) {
    json(response, 401, { ok: false, error: "Companion Token 不正确" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/codex/threads") {
    const searchTerm = url.searchParams.get("q") || undefined;
    const threads = await codex.listThreads({ limit: 50, searchTerm });
    json(response, 200, { ok: true, threads: threads.map(publicThread) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/codex/dispatch") {
    const body = await readJson(request);
    const externalId = String(body.externalId || "").trim();
    const threadId = String(body.threadId || "").trim();
    const prompt = String(body.prompt || "").trim();
    const executionMode = body.executionMode === "readOnly" ? "readOnly" : "workspaceWrite";
    if (!externalId || !threadId || !prompt) {
      json(response, 400, { ok: false, error: "externalId、threadId 和 prompt 都是必填项" });
      return;
    }
    if (prompt.length > 30_000) {
      json(response, 400, { ok: false, error: "任务内容不能超过 30000 字符" });
      return;
    }
    const existingTaskId = idempotency.get(externalId);
    if (existingTaskId) {
      json(response, 200, { ok: true, duplicate: true, task: tasks.get(existingTaskId) });
      return;
    }

    const taskId = randomUUID();
    const task = {
      id: taskId,
      externalId,
      threadId,
      executionMode,
      status: "starting",
      reply: "",
      error: null,
      createdAt: new Date().toISOString(),
    };
    tasks.set(taskId, task);
    idempotency.set(externalId, taskId);

    try {
      const { thread, turn } = await codex.startTurn(threadId, prompt, executionMode);
      task.threadName = thread.name || "未命名任务";
      task.turnId = turn?.id || null;
      task.status = turn?.status === "inProgress" ? "running" : "accepted";
      json(response, 202, { ok: true, duplicate: false, task });
    } catch (error) {
      task.status = "failed";
      task.error = error.message;
      json(response, 409, { ok: false, error: error.message, task });
    }
    return;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (request.method === "GET" && taskMatch) {
    const task = tasks.get(decodeURIComponent(taskMatch[1]));
    if (!task) {
      json(response, 404, { ok: false, error: "任务不存在" });
      return;
    }
    json(response, 200, { ok: true, task });
    return;
  }

  json(response, 404, { ok: false, error: "接口不存在" });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    json(response, 500, { ok: false, error: error.message || "内部错误" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Desktop Agent Dispatcher Companion: http://${HOST}:${PORT}`);
  console.log(`Companion Token: ${TOKEN}`);
  console.log("请将 Token 填入网页的“本机 Companion”设置中。\n");
});

function shutdown() {
  codex.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
