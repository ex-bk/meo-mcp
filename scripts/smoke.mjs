// 動作確認：本物の接続先は使わず、手元に小さな模擬サーバー（/api/meo/mcp と同じ鍵の形式）を立てて試す。
import http from "node:http";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const GOOD = "test-key-not-real";
const web = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${GOOD}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "鍵が正しくありません" }, id: null }));
  }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const mcp = new McpServer({ name: "mock", version: "1" });
  mcp.registerTool("locations_list", { description: "店舗の一覧", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "[{\"name\":\"テスト店\"}]" }] }));
  mcp.registerTool("echo", { description: "e", inputSchema: { q: z.string() } }, async ({ q }) => ({ content: [{ type: "text", text: q }] }));
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(t);
  await t.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString()));
});
await new Promise((r) => web.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${web.address().port}`;

async function run(label, env) {
  const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, ...env }, stderr: "ignore" });
  const c = new Client({ name: "smoke", version: "1" });
  await c.connect(t); // initialize に応答する
  console.log(`[${label}] initialize OK server=${JSON.stringify(c.getServerVersion())}`);
  try {
    const l = await c.listTools();
    console.log(`[${label}] tools/list:`, l.tools.map((x) => x.name).join(","));
    const r = await c.callTool({ name: "echo", arguments: { q: "こんにちは" } });
    console.log(`[${label}] tools/call:`, JSON.stringify(r.content));
  } catch (e) {
    console.log(`[${label}] エラー:`, e.message);
  }
  await c.close();
}

await run("鍵なし", { EXBK_MEO_API_KEY: "", EXBK_MEO_URL: url });
await run("鍵まちがい", { EXBK_MEO_API_KEY: "wrong", EXBK_MEO_URL: url });
await run("鍵あり", { EXBK_MEO_API_KEY: GOOD, EXBK_MEO_URL: url });
web.close();
process.exit(0);
