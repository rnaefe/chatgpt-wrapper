import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { taskRequestSchema, statusSchema } from "@chatgpt-wrapper/contracts";

import { deliverImage } from "./image-delivery.js";
import { registerBatchTools } from "./batch-mcp.js";
import { packageMetadata } from "./runtime-paths.js";
import type { localClient } from "./local-client.js";
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
export function createMcpServer(
  api: Awaited<ReturnType<typeof localClient>>,
  directory: string,
) {
  const server = new McpServer(
    {
      name: "chatgpt-wrapper",
      version: packageMetadata.version,
    },
    {
      instructions:
        "Use submit_task once, keep its returned ID, and use wait_task until terminal. Pass the last progress.revision as afterProgressRevision (0 for older tasks without progress) to receive stage changes early, and share meaningful progress.message updates with the user. Continue waiting after nonterminal updates; do not resubmit slow or unconfirmed work. Supply context inline or via explicit image/file attachments; local file paths require FILE_INPUT_ROOTS and no repository scan is performed. Use submit_batch once for independent jobs and keep its batch ID; use get_batch to collect results, and never wait on missingTaskIds removed by retention. Research uses research.search; share result.sources as links, without claiming independent source verification. Review returned code before applying it. For image results, retrieve each image artifact and include its displayMarkdown and downloadMarkdown in the final reply. NEEDS_AUTH and NEEDS_HUMAN require user attention; no automatic retry is made.",
    },
  );
  server.registerTool(
    "submit_task",
    {
      description:
        "Queue a task and return its ID immediately. Use files for selected code/PDF/DOCX/text attachments (local paths require FILE_INPUT_ROOTS); research.search enables Search and returns source links. Optional model selects an exact visible ChatGPT model label; optional conversationId continues a prior result's conversation (not its task ID). Omit these for a new chat with the browser selection. Use wait_task; use submit_batch for multiple independent jobs.",
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
    "wait_task",
    {
      description:
        "Wait up to 30 seconds for a terminal state, or a newer progress revision when afterProgressRevision is supplied. Returns current state on timeout. Continue waiting after nonterminal stage updates; never resubmit work.",
      inputSchema: {
        id: z.string().uuid(),
        waitMs: z.number().int().min(0).max(30_000).default(30_000),
        afterProgressRevision: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      },
    },
    async ({ id, waitMs, afterProgressRevision }) =>
      result(
        await (
          await api(
            `/v1/tasks/${id}/wait?waitMs=${waitMs}${afterProgressRevision === undefined ? "" : `&afterProgressRevision=${afterProgressRevision}`}`,
            undefined,
            waitMs + 5000,
          )
        ).json(),
      ),
  );
  server.registerTool(
    "get_status",
    {
      description:
        "Read provider readiness, supported capabilities, browser state and task counts. Does not submit work or open a browser.",
      inputSchema: {},
    },
    async () => result(await (await api("/v1/status")).json()),
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
      description:
        "Cancel a queued or running task. No automatic retry is made.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) =>
      result(await (await api(`/v1/tasks/${id}/cancel`, {})).json()),
  );
  server.registerTool(
    "get_artifact",
    {
      description:
        "Read an artifact. Images return MCP image content plus a local file path and Markdown for displaying and downloading in the final chat reply. Call this after image generation; include the returned displayMarkdown in your final response.",
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
      if (mime.startsWith("image/"))
        return deliverImage(id, data, mime, directory);
      if (data.length > 10 * 1024 * 1024)
        return result({
          id,
          error: "ARTIFACT_TOO_LARGE",
          message:
            "Artifact exceeds the 10 MiB MCP delivery limit; retrieve it through the authenticated loopback HTTP endpoint.",
        });
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
  registerBatchTools(server, api);
  return server;
}
