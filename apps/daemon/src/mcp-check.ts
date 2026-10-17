import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpCommand } from "./client-config.js";

/** Verify the installed entry itself, without sending a provider prompt. */
export async function checkMcp(entry: McpCommand) {
  const client = new Client({ name: "wrapper-setup", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: entry.command,
        args: entry.args,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (item): item is [string, string] => item[1] !== undefined,
            ),
          ),
          ...entry.env,
        },
        stderr: "pipe",
      }),
      { timeout: 15000 },
    );
    const names = new Set(
      (await client.listTools({}, { timeout: 10000 })).tools.map(
        (tool) => tool.name,
      ),
    );
    for (const name of [
      "submit_task",
      "get_task",
      "wait_task",
      "get_status",
      "list_tasks",
      "cancel_task",
      "get_artifact",
      "get_metrics",
      "list_errors",
    ])
      if (!names.has(name))
        throw new Error(
          `Installed MCP server is missing ${name}. Run setup again to repair it.`,
        );
    return names.size;
  } finally {
    await client.close();
  }
}
