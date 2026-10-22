import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { batchRequestSchema } from "@chatgpt-wrapper/contracts";
import type { Store } from "@chatgpt-wrapper/core";

export function registerBatchRoutes(server: FastifyInstance, store: Store) {
  server.post("/v1/batches", async (req, reply) => {
    const parsed = batchRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "INVALID_BATCH", details: parsed.error.flatten() });
    const header = req.headers["idempotency-key"];
    if (header !== undefined) {
      const key = z.string().min(1).max(200).safeParse(header);
      if (!key.success)
        return reply.code(400).send({ error: "INVALID_IDEMPOTENCY_KEY" });
      if (parsed.data.idempotencyKey && parsed.data.idempotencyKey !== key.data)
        return reply.code(400).send({ error: "IDEMPOTENCY_KEY_MISMATCH" });
      parsed.data.idempotencyKey = key.data;
    }
    const batch = store.submitBatch(parsed.data);
    return reply.code(batch.reused ? 200 : 202).send(batch);
  });
  server.get<{ Params: { id: string } }>(
    "/v1/batches/:id",
    async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.id).success)
        return reply.code(400).send({ error: "INVALID_BATCH_ID" });
      const batch = store.getBatch(req.params.id);
      return batch ?? reply.code(404).send({ error: "BATCH_NOT_FOUND" });
    },
  );
}
