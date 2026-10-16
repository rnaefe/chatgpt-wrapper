import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { taskRequestSchema, statusSchema } from "@chatgpt-wrapper/contracts";

import { localClient } from "./local-client.js";
// All MCP clients share the daemon; startup and local authentication are automatic.
const api = await localClient();
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
const server = new McpServer({ name: "chatgpt-wrapper", version: "0.3.0" });
server.registerTool(
  "submit_task",
  {
    description:
      "Queue a task and return its ID immediately. Poll get_task for completion.",
    inputSchema: taskRequestSchema,
  },
  async (request) => result(await (await api("/v1/tasks", request)).json()),
);
server.registerTool(
  "get_task",
  {
    description: "Read task status, result, provenance and event history.",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }) => result(await (await api(`/v1/tasks/${id}`)).json()),
);
server.registerTool(
  "list_tasks",
  {
    description: "List submitted tasks, newest first.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: statusSchema.optional(),
    },
  },
  async ({ limit, offset, status }) =>
    result(
      await (
        await api(
          `/v1/tasks?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ""}`,
        )
      ).json(),
    ),
);
server.registerTool(
  "cancel_task",
  {
    description: "Cancel a queued or running task. No automatic retry is made.",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }) =>
    result(await (await api(`/v1/tasks/${id}/cancel`, {})).json()),
);
server.registerTool(
  "get_artifact",
  {
    description: "Read the text artifact from a completed task.",
    inputSchema: { id: z.string().regex(/^[a-f0-9]{64}$/) },
  },
  async ({ id }) => {
    const response = await api(`/v1/artifacts/${id}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 5 * 1024 * 1024)
      return result({
        id,
        message:
          "Artifact exceeds MCP delivery limit; download through authenticated HTTP endpoint",
      });
    return {
      content: [{ type: "text" as const, text: data.toString("utf8") }],
    };
  },
);
await server.connect(new StdioServerTransport());
