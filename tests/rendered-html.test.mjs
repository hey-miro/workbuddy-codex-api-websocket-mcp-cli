import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the desktop agent dispatcher", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Desktop Agent Dispatcher<\/title>/i);
  assert.match(html, /让外部系统唤醒桌面 Agent/);
  assert.match(html, /Codex Desktop/);
  assert.match(html, /WorkBuddy/);
  assert.match(html, /本机 Companion/);
  assert.match(html, /必须复用原任务/);
});

test("does not claim a live local connection during server render", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /正在检查本机 Companion/);
  assert.doesNotMatch(html, /127\.0\.0\.1 · 已连接/);
});
