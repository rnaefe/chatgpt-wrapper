import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../packages/core/dist/index.js";
import { Worker } from "../apps/daemon/dist/worker.js";
import { taskRequestSchema } from "../packages/contracts/dist/index.js";

// A deterministic local provider isolates Wrapper's queue overhead from ChatGPT latency.
const directory = await mkdtemp(join(tmpdir(), "wrapper-benchmark-"));
const store = new Store(directory);
const worker = new Worker(
  store,
  {
    info: () => ({
      name: "benchmark",
      configured: true,
      model: "fixture",
      capabilities: ["reason.analyze"],
    }),
    execute: async () => ({
      text: "done",
      adapter: "benchmark",
      model: "fixture",
    }),
  },
  0,
);
const samples = [];
try {
  worker.start();
  for (let index = 0; index < 12; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const start = performance.now();
    const { task } = store.submit(
      taskRequestSchema.parse({
        capability: "reason.analyze",
        objective: `benchmark ${index}`,
      }),
    );
    while (!store.get(task.id)?.finishedAt)
      await new Promise((resolve) => setTimeout(resolve, 1));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        samples: samples.length,
        medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
        p95Ms: +samples[Math.ceil(samples.length * 0.95) - 1].toFixed(2),
        scope:
          "local queue + validation + persistence; excludes browser/provider",
      },
      null,
      2,
    ),
  );
} finally {
  await worker.stop();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
