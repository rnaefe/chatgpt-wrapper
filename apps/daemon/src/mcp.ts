import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { taskRequestSchema, statusSchema } from "@chatgpt-wrapper/contracts";

import { packageMetadata } from "./runtime-paths.js";
import { localClient } from "./local-client.js";
// All MCP clients share the daemon; startup and local authentication are automatic.
const api = await localClient();
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
const server = new McpServer({
  name: "chatgpt-wrapper",
  version: packageMetadata.version,
});
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
    description:
      "Read a completed text artifact or an image artifact (base64-encoded MCP image content).",
    inputSchema: { id: z.string().regex(/^[a-f0-9]{64}$/) },
  },
  async ({ id }) => {
    const response = await api(`/v1/artifacts/${id}`);
    const data = Buffer.from(await response.arrayBuffer());
    const mime = (
      response.headers.get("content-type") ?? "application/octet-stream"
    )
      .split(";")[0]
      .trim();
    if (data.length > 10 * 1024 * 1024)
      return result({
        id,
        error: "ARTIFACT_TOO_LARGE",
        message:
          "Artifact exceeds the 10 MiB MCP delivery limit; retrieve it through the authenticated loopback HTTP endpoint.",
      });
    if (mime.startsWith("image/"))
      return {
        content: [
          {
            type: "image" as const,
            data: data.toString("base64"),
            mimeType: mime,
          },
        ],
      };
    if (!mime.startsWith("text/"))
      return result({ id, error: "UNSUPPORTED_ARTIFACT_TYPE", mime });
    return {
      content: [{ type: "text" as const, text: data.toString("utf8") }],
    };
  },
);
server.registerTool(
  "get_metrics",
  {
    description:
      "Read local task success rates, duration percentiles and error-code counts. Excludes prompts and responses. These are Wrapper task metrics, not ChatGPT quota telemetry.",
    inputSchema: { hours: z.number().int().min(1).max(720).default(24) },
  },
  async ({ hours }) =>
    result(await (await api(`/v1/metrics?hours=${hours}`)).json()),
);
server.registerTool(
  "list_errors",
  {
    description:
      "List recent local task failures by task ID, status and error code, without prompt or response text.",
    inputSchema: {
      hours: z.number().int().min(1).max(720).default(24),
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ hours, limit }) =>
    result(
      await (await api(`/v1/errors?hours=${hours}&limit=${limit}`)).json(),
    ),
);
await server.connect(new StdioServerTransport());
