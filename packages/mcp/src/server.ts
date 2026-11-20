import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CORE_VERSION } from "@pm/core";
import { TOOLS } from "./tools.js";
import { dispatchCall } from "./dispatch.js";
import type { ToolContext } from "./context.js";

/**
 * MCP server 工厂（04-mcp §1 调用约定）：
 * - 低阶 Server + tools capability，stdio 传输（入口见 main.ts，--root 指定工程根）；
 * - tools/list 输出 04-mcp §2 全量工具清单（name/description/inputSchema 同源）；
 * - tools/call 经 dispatchCall 统一信封（04-mcp §1.1 错误语义 + ok 信封）。
 */
export const SERVER_NAME = "pm-mcp";
export const SERVER_VERSION = CORE_VERSION;

export function createPmServer(root?: string): Server {
  const ctx: ToolContext = { root };
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const result = await dispatchCall(name, args, ctx);
    // ToolCallResult 与 SDK CallToolResult 结构兼容（details 为 04-mcp §1.1 附加字段，passthrough）
    return result as unknown as CallToolResult;
  });

  return server;
}
