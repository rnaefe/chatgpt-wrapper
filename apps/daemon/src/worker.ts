import { Store } from "@chatgpt-wrapper/core";
import { ProviderError, type Adapter } from "@chatgpt-wrapper/adapters";
import { validateImages, validateText } from "@chatgpt-wrapper/validation";
import type { Task, TaskStatus } from "@chatgpt-wrapper/contracts";

export class Worker {
  private active?: {
    id: string;
    controller: AbortController;
    done: Promise<void>;
  };
  private stopping = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastRetentionSweep = 0;
  private unsubscribe?: () => void;
  private scheduled = false;

  private wake() {
    if (this.scheduled || this.stopping || !this.timer) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.runTick();
    });
  }

  constructor(
    private readonly store: Store,
    readonly adapter: Adapter,
    private readonly retentionDays = 30,
  ) {}

  start() {
    if (this.timer) return;
    this.store.recover();
    // The fallback handles readiness changes after sign-in; submissions wake immediately.
    this.timer = setInterval(() => void this.runTick(), 1000);
    this.unsubscribe = this.store.onTaskChange((task) => {
      if (task.status === "QUEUED") this.wake();
    });
    void this.runTick();
  }

  private async runTick() {
    try {
      await this.tick();
    } catch (error) {
      console.error(
        "Worker error",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  async tick() {
    if (this.active || this.stopping) return;
    if (
      this.retentionDays > 0 &&
      Date.now() - this.lastRetentionSweep >= 86_400_000
    ) {
      this.lastRetentionSweep = Date.now();
      this.store.pruneOlderThan(
        new Date(Date.now() - this.retentionDays * 86_400_000),
      );
    }
    if (this.adapter.canStart?.() === false) return;
    const next = this.store.next();
    if (!next) return;
    const task = this.store.transition(
      next.id,
      "RUNNING",
      {},
      "Worker claimed task",
    );
    const controller = new AbortController();
    const done = Promise.resolve().then(() => this.execute(task, controller));
    this.active = { id: task.id, controller, done };
    try {
      await done;
    } finally {
      this.active = undefined;
      this.wake();
    }
  }
  cancel(id: string) {
    const task = this.store.get(id);
    if (!task) return undefined;
    const result = this.store.transition(
      id,
      "CANCELLED",
      {},
      "Cancelled by client",
    );
    if (this.active?.id === id) this.active.controller.abort();
    return result;
  }
  private async execute(task: Task, controller: AbortController) {
    const timeout = setTimeout(
      () => controller.abort(new Error("Task deadline exceeded")),
      task.request.timeoutSeconds * 1000,
    );
    try {
      const output = await this.adapter.execute(
        task.request,
        controller.signal,
      );
      if (controller.signal.aborted) return this.failAborted(task.id);
      if (this.store.get(task.id)?.status === "CANCELLED") return;
      this.store.transition(
        task.id,
        "VALIDATING",
        {},
        "Validating provider output",
      );
      const checks = validateText(output.text, task.request);
      const imageChecks = validateImages(output.images ?? [], task.request);
      const artifacts = [
        ...(output.text.trim()
          ? [
              this.store.putArtifact(
                Buffer.from(output.text),
                "text/plain",
                `${output.adapter}:${output.model}`,
                "text",
              ),
            ]
          : []),
        ...(output.images ?? []).map((image) =>
          this.store.putArtifact(image.data, image.mime, image.source, "image"),
        ),
      ];
      this.store.transition(
        task.id,
        "COMPLETED",
        {
          result: {
            text: output.text,
            artifacts,
            provenance: { adapter: output.adapter, model: output.model },
            validation: { passed: true, checks: [...checks, ...imageChecks] },
          },
        },
        "Result stored",
      );
    } catch (e) {
      if (this.store.get(task.id)?.status === "CANCELLED") return;
      if (controller.signal.aborted) this.failAborted(task.id);
      else if (e instanceof ProviderError)
        this.failIfActive(task.id, e.code, e.message, e.status);
      else
        this.failIfActive(
          task.id,
          "VALIDATION_FAILED",
          e instanceof Error ? e.message : "Task failed",
        );
    } finally {
      clearTimeout(timeout);
    }
  }
  private failAborted(id: string) {
    this.failIfActive(
      id,
      this.stopping ? "WORKER_STOPPED" : "DEADLINE_EXCEEDED",
      this.stopping
        ? "Worker stopped during execution; no automatic retry was made"
        : "Provider request exceeded the task deadline; no automatic retry was made",
    );
  }
  private failIfActive(
    id: string,
    code: string,
    message: string,
    status: TaskStatus = "FAILED",
  ) {
    this.store.transition(id, status, { error: { code, message } }, message);
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.active?.controller.abort();
    await this.active?.done;
    await this.adapter.close?.();
  }
}
