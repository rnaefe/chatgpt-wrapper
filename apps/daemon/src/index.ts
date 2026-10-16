import { createServer } from "./server.js";
import { runtime } from "./config.js";

const HOST = "127.0.0.1";

async function main() {
  const app = runtime();
  const server = createServer({ ...app, logger: true });
  let shuttingDown = false;

  const shutdown = async (signal?: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (signal) console.log(`Received ${signal}; shutting down.`);

    try {
      await server.close();
    } finally {
      try {
        await app.worker.stop();
      } finally {
        app.store.close();
        app.release();
      }
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await server.listen({ host: HOST, port: app.port });
    app.worker.start();
    console.log(`Daemon listening on http://${HOST}:${app.port}`);
  } catch (error) {
    console.error(
      "Daemon failed to start",
      error instanceof Error ? error.message : "Unknown error",
    );
    await shutdown();
    process.exitCode = 1;
  }
}

await main();
