import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchRequestSchema } from "@chatgpt-wrapper/contracts";
import type { localClient } from "./local-client.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
export function registerBatchTools(
  server: McpServer,
  api: Awaited<ReturnType<typeof localClient>>,
) {
  server.registerTool(
    "submit_batch",
    {
      description:
        "Atomically queue 1–20 tasks and return a durable batch ID. Tasks use the existing serial worker. Reuse the batch ID; do not resubmit slow work. A batch idempotency key deduplicates the whole submission.",
      inputSchema: batchRequestSchema,
    },
    async (request) => result(await (await api("/v1/batches", request)).json()),
  );
  server.registerTool(
    "get_batch",
    {
      description:
        "Read a batch's tasks, status counts and terminal flag. Retention may remove individual tasks: missingTaskIds lists them and terminal stays false. Use wait_task for retained nonterminal tasks. Once all tasks expire, the batch is removed.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => result(await (await api(`/v1/batches/${id}`)).json()),
  );
}
