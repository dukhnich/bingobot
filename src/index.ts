#!/usr/bin/env node
/**
 * index.ts — chgk-mcp server entry point.
 *
 * Assembles the tools + resources + prompts and speaks MCP over stdio. stdout is the
 * JSON-RPC protocol channel, so ALL logging must go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "chgk-mcp", version: "0.1.0" });

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chgk-mcp running on stdio (ЧГК / gotquestions.online)");
}

main().catch((err) => {
  console.error("chgk-mcp fatal error:", err);
  process.exit(1);
});
