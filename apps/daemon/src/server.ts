import { packageMetadata } from "./runtime-paths.js";
import { PlaywrightAdapter } from "./playwright-adapter.js";
import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { taskRequestSchema, statusSchema } from "@chatgpt-wrapper/contracts";
import { ConflictError, type Store } from "@chatgpt-wrapper/core";
import type { Worker } from "./worker.js";

export function createServer(options: {
  store: Store;
  worker: Worker;
  token: string;
  logger?: boolean;
}) {
  const { store, worker, token } = options;
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 29 * 1024 * 1024,
  });
  server.addHook("onRequest", async (req, reply) => {
    const expected = new Set([
      `127.0.0.1:${req.socket.localPort}`,
      `localhost:${req.socket.localPort}`,
    ]);
    // Injected requests in tests have no socket port.
    if (
      !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "") ||
      (req.socket.localPort && !expected.has(req.headers.host ?? ""))
    )
      return reply.code(403).send({ error: "INVALID_HOST" });
    if (req.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        return reply.code(403).send({ error: "INVALID_ORIGIN" });
      }
      if (origin.protocol !== "http:" || !expected.has(origin.host))
        return reply.code(403).send({ error: "INVALID_ORIGIN" });
    }
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    if (req.url.split("?")[0] === "/health") return;
    const auth = req.headers.authorization ?? "";
    const expectedAuth = `Bearer ${token}`;
    if (
      Buffer.byteLength(auth) !== Buffer.byteLength(expectedAuth) ||
      !timingSafeEqual(Buffer.from(auth), Buffer.from(expectedAuth))
    )
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Provide your local API token",
      });
  });
  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof ConflictError)
      return reply
        .code(409)
        .send({ error: "CONFLICT", message: error.message });
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    reply.code(status).send({
      error: status < 500 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message:
        status < 500 && error instanceof Error
          ? error.message
          : "Request failed",
    });
  });
  const params = z.object({ id: z.string().min(1).max(100) });
  server.get("/health", async () => ({
    status: "ok",
    service: "chatgpt-wrapper",
  }));
  server.get("/v1/status", async () => ({
    runtime: { pid: process.pid, version: packageMetadata.version },
    provider: worker.adapter.info(),
    counts: store.counts(),
    browserAdapter:
      worker.adapter instanceof PlaywrightAdapter
        ? { enabled: true, ...worker.adapter.status() }
        : { enabled: false, reason: "API adapter selected" },
  }));
  server.get("/v1/metrics", async (req, reply) => {
    const query = z
      .object({ hours: z.coerce.number().int().min(1).max(720).default(24) })
      .safeParse(req.query);
    if (!query.success)
      return reply.code(400).send({ error: "INVALID_METRICS_QUERY" });
    return store.metrics(query.data.hours);
  });
  server.get("/v1/errors", async (req, reply) => {
    const query = z
      .object({
        hours: z.coerce.number().int().min(1).max(720).default(24),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .safeParse(req.query);
    if (!query.success)
      return reply.code(400).send({ error: "INVALID_ERRORS_QUERY" });
    return {
      errors: store.failures(query.data.limit, query.data.hours),
      ...query.data,
    };
  });
  server.post("/v1/browser/connect", async (_req, reply) => {
    if (!(worker.adapter instanceof PlaywrightAdapter))
      return reply.code(409).send({ error: "HEADLESS_ADAPTER_REQUIRED" });
    if (!worker.adapter.canStart())
      return reply.code(409).send({
        error: "BROWSER_BUSY",
        message: "A task or sign-in is already in progress.",
      });
    void worker.adapter.connect().catch((error) => {
      console.error(
        "Browser connection failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    });
    return reply.code(202).send({ accepted: true });
  });
  server.post("/v1/tasks", async (req, reply) => {
    const parsed = taskRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "INVALID_TASK", details: parsed.error.flatten() });
    const header = req.headers["idempotency-key"];
    if (header) {
      const key = z.string().min(1).max(200).safeParse(header);
      if (!key.success)
        return reply.code(400).send({ error: "INVALID_IDEMPOTENCY_KEY" });
      if (parsed.data.idempotencyKey && parsed.data.idempotencyKey !== key.data)
        return reply.code(400).send({ error: "IDEMPOTENCY_KEY_MISMATCH" });
      parsed.data.idempotencyKey = key.data;
    }
    const result = store.submit(parsed.data);
    return reply
      .code(result.reused ? 200 : 202)
      .send({ ...result.task, reused: result.reused });
  });
  server.get("/v1/tasks", async (req, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        status: statusSchema.optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    return {
      tasks: store.list(query.data.limit, query.data.offset, query.data.status),
      ...query.data,
    };
  });
  server.get<{ Params: { id: string } }>(
    "/v1/tasks/:id",
    async (req, reply) => {
      if (!params.safeParse(req.params).success)
        return reply.code(400).send({ error: "INVALID_ID" });
      const task = store.get(req.params.id);
      return task
        ? { ...task, events: store.events(task.id) }
        : reply.code(404).send({ error: "TASK_NOT_FOUND" });
    },
  );
  server.post<{ Params: { id: string } }>(
    "/v1/tasks/:id/cancel",
    async (req, reply) =>
      worker.cancel(req.params.id) ??
      reply.code(404).send({ error: "TASK_NOT_FOUND" }),
  );
  server.get<{ Params: { id: string } }>(
    "/v1/artifacts/:id",
    async (req, reply) => {
      const artifact = store.artifact(req.params.id);
      if (!artifact)
        return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
      return reply
        .type(artifact.mime)
        .header(
          "Content-Disposition",
          `attachment; filename="${artifact.id}.${artifact.mime === "text/plain" ? "txt" : artifact.mime.split("/")[1]}"`,
        )
        .send(store.artifactData(artifact.id));
    },
  );
  return server;
}
