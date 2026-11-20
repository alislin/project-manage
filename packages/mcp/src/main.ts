#!/usr/bin/env node
// MCP server 入口（04-mcp §1 调用约定；stdio 传输）：pm-mcp [--root <path>]
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPmServer } from "./server.js";
import { parseLaunchArgs } from "./launch.js";

const parsed = parseLaunchArgs(process.argv.slice(2));
if (!parsed.ok) {
  if (parsed.message !== undefined) console.error(parsed.message);
  process.exit(parsed.exitCode);
}

const server = createPmServer(parsed.root);
await server.connect(new StdioServerTransport());
