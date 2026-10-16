import Fastify from "fastify";
import { z } from "zod";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";

const server = Fastify({ logger: true });
const tasks = new Map<string, { id: string; status: "AWAITING_USER" | "COMPLETED"; request: z.infer<typeof taskRequestSchema>; result?: string }>();

server.get("/health", async () => ({ status: "ok", mode: "manual-handoff" }));
server.post("/v1/tasks", async (request, reply) => {
  const parsed = taskRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_TASK", details: parsed.error.flatten() });
  const id = crypto.randomUUID();
  tasks.set(id, { id, status: "AWAITING_USER", request: parsed.data });
  return reply.code(202).send({ id, status: "AWAITING_USER" });
});
server.get<{ Params: { id: string } }>("/v1/tasks/:id", async (request, reply) => {
  const task = tasks.get(request.params.id);
  return task ?? reply.code(404).send({ error: "TASK_NOT_FOUND" });
});
server.post<{ Params: { id: string } }>("/v1/tasks/:id/results", async (request, reply) => {
  const task = tasks.get(request.params.id);
  if (!task) return reply.code(404).send({ error: "TASK_NOT_FOUND" });
  const parsed = z.object({ result: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_RESULT" });
  task.status = "COMPLETED";
  task.result = parsed.data.result;
  return { id: task.id, status: task.status };
});

await server.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 11435) });
