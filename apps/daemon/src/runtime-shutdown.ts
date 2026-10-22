/** Stop claims and abort active execution before closing transports that may await it. */
export async function shutdownRuntime(options: {
  stopWorker: () => Promise<unknown>;
  closeServer: () => PromiseLike<unknown>;
  closeStore: () => void;
  release: () => void;
}): Promise<void> {
  const start = (operation: () => PromiseLike<unknown>): Promise<unknown> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // Invoke directly: worker.stop() disables scheduling and aborts synchronously.
  const worker = start(options.stopWorker);
  const server = start(options.closeServer);
  const settled = await Promise.allSettled([worker, server]);
  const errors: unknown[] = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  try {
    options.closeStore();
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      options.release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Daemon shutdown failed");
}
