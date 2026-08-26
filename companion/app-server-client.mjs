import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";

const MAC_CODEX_BINARY = "/Applications/Codex.app/Contents/Resources/codex";

function resolveCodexBinary() {
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;
  if (existsSync(MAC_CODEX_BINARY)) return MAC_CODEX_BINARY;
  return "codex";
}

export class CodexAppServerClient {
  constructor() {
    this.process = null;
    this.pending = new Map();
    this.notificationListeners = new Set();
    this.nextRequestId = 1;
    this.readyPromise = null;
    this.lastError = null;
  }

  get connected() {
    return Boolean(this.process && !this.process.killed);
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.#startProcess().catch((error) => {
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  async #startProcess() {
    const child = spawn(resolveCodexBinary(), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.process = child;

    child.once("exit", (code, signal) => {
      const error = new Error(`Codex App Server 已退出（code=${code}, signal=${signal}）`);
      this.lastError = error.message;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
      this.process = null;
      this.readyPromise = null;
    });

    child.stderr.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (/error|failed|panic/i.test(line)) this.lastError = line.slice(0, 500);
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      this.#handleMessage(message);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "desktop_agent_dispatcher",
        title: "Desktop Agent Dispatcher",
        version: "0.2.0",
      },
    });
    this.notify("initialized", {});
  }

  #handleMessage(message) {
    if (message.id !== undefined && message.method) {
      this.#respondToServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "Codex App Server 请求失败");
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const listener of this.notificationListeners) {
        try {
          listener(message);
        } catch {
          // A consumer must not break the protocol reader.
        }
      }
    }
  }

  #respondToServerRequest(message) {
    const method = String(message.method || "");
    const approvalRequest = method.includes("requestApproval");
    if (approvalRequest) {
      this.#write({ id: message.id, result: { decision: "decline" } });
      return;
    }
    this.#write({
      id: message.id,
      error: { code: -32601, message: `Companion 不支持服务端请求：${method}` },
    });
  }

  #write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Codex App Server 未连接");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params = {}, timeoutMs = 30_000) {
    if (method !== "initialize") await this.start();
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  async listThreads({ limit = 30, searchTerm } = {}) {
    const params = { limit, archived: false };
    if (searchTerm) params.searchTerm = searchTerm;
    const result = await this.request("thread/list", params);
    return result?.data || [];
  }

  async readThread(threadId) {
    const result = await this.request("thread/read", { threadId, includeTurns: false });
    return result?.thread;
  }

  async startTurn(threadId, prompt, executionMode = "workspaceWrite") {
    const resumed = await this.request("thread/resume", { threadId });
    const thread = resumed?.thread;
    if (!thread?.id) throw new Error("无法续接指定 Codex 任务");

    const params = {
      threadId,
      input: [{ type: "text", text: prompt }],
      approvalPolicy: "never",
    };
    if (executionMode === "readOnly") {
      params.sandboxPolicy = { type: "readOnly" };
    } else if (thread.cwd) {
      params.sandboxPolicy = {
        type: "workspaceWrite",
        writableRoots: [thread.cwd],
        networkAccess: false,
      };
    }

    const result = await this.request("turn/start", params);
    return { thread, turn: result?.turn };
  }

  stop() {
    this.process?.kill();
    this.process = null;
    this.readyPromise = null;
  }
}
