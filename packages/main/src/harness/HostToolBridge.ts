import http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { HostTool } from "@app/core";

/**
 * A single in-process MCP server that bridges opencode's agent to host-executed
 * tools (Workstream C's `open_repo`). opencode connects to it as a remote MCP
 * server (configured per session via the workspace-root `opencode.json`); each
 * session's tools are routed by the URL path `/mcp/<sessionId>`.
 *
 * Verified against opencode 1.17.6: serve (cwd = workspace root with the mcp
 * config) → initialize → tools/list → tools/call → our handler runs in main.
 */
class HostToolBridge {
  private server: http.Server | null = null;
  private baseUrl: string | null = null;
  private readonly sessions = new Map<string, HostTool[]>();

  /** Lazily start the HTTP server; returns its base URL. */
  async start(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (this.server!.address() as AddressInfo).port;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  register(sessionId: string, tools: HostTool[]): void {
    this.sessions.set(sessionId, tools);
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** The MCP URL opencode should connect to for a given session. */
  urlFor(sessionId: string): string {
    return `${this.baseUrl}/mcp/${encodeURIComponent(sessionId)}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const match = req.url?.match(/^\/mcp\/([^/?]+)/);
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const sessionId = decodeURIComponent(match[1]);
    const tools = this.sessions.get(sessionId) ?? [];

    // Read + parse the JSON-RPC body (the transport reuses the parsed value).
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }

    // Stateless: a fresh MCP server + transport per request, configured with
    // this session's tools. Avoids session-id/transport lifecycle bugs.
    const server = this.buildServer(tools);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("[HostToolBridge] request failed:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    }
  }

  private buildServer(tools: HostTool[]): Server {
    const server = new Server({ name: "multiplex", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const tool = tools.find((t) => t.name === req.params.name);
      if (!tool) {
        return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
      }
      const result = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: "text", text: result.content }], isError: result.isError ?? false };
    });
    return server;
  }
}

export const hostToolBridge = new HostToolBridge();
