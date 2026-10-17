import { durationSummary, elapsed, windowStart } from "./metrics.js";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  terminalStatuses,
  type Task,
  type TaskRequest,
  type TaskStatus,
  type Artifact,
  type TaskEvent,
} from "@chatgpt-wrapper/contracts";

const DEFAULT_TASK_LIMIT = 50;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
const RECOVERABLE_STATUSES = ["RUNNING", "VALIDATING"] as const;
const ALLOWED_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: [
    "VALIDATING",
    "FAILED",
    "CANCELLED",
    "NEEDS_AUTH",
    "NEEDS_HUMAN",
    "BLOCKED_BY_PROVIDER",
  ],
  VALIDATING: ["COMPLETED", "FAILED", "CANCELLED"],
};

export class ConflictError extends Error {}

export class Store {
  private readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    mkdirSync(join(directory, "artifacts"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "tasks.sqlite"));
    chmodSync(join(directory, "tasks.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, key TEXT UNIQUE, fingerprint TEXT, created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, created);
      CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  }
  get(id: string): Task | undefined {
    const row = this.db.prepare("SELECT body FROM tasks WHERE id=?").get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  list(limit = DEFAULT_TASK_LIMIT, offset = 0, status?: TaskStatus): Task[] {
    const rows = status
      ? this.db
          .prepare(
            "SELECT body FROM tasks WHERE status=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          )
          .all(status, limit, offset)
      : this.db
          .prepare(
            "SELECT body FROM tasks ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          )
          .all(limit, offset);
    return rows.map((r) => JSON.parse(String(r.body)));
  }
  counts(): Record<string, number> {
    return Object.fromEntries(
      this.db
        .prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status")
        .all()
        .map((r) => [String(r.status), Number(r.n)]),
    );
  }
  submit(request: TaskRequest): { task: Task; reused: boolean } {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...request, idempotencyKey: undefined }))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (request.idempotencyKey) {
        const row = this.db
          .prepare("SELECT body,fingerprint FROM tasks WHERE key=?")
          .get(request.idempotencyKey);
        if (row) {
          if (row.fingerprint !== fingerprint)
            throw new ConflictError(
              "Idempotency key already used with different input",
            );
          this.db.exec("COMMIT");
          return { task: JSON.parse(String(row.body)), reused: true };
        }
      }
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        status: "QUEUED",
        request,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?)")
        .run(
          task.id,
          task.status,
          JSON.stringify(task),
          request.idempotencyKey ?? null,
          fingerprint,
          now,
        );
      this.recordEvent(task, "Submitted");
      this.db.exec("COMMIT");
      return { task, reused: false };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private recordEvent(task: Task, detail?: string) {
    this.db
      .prepare("INSERT INTO events(task_id,body) VALUES (?,?)")
      .run(
        task.id,
        JSON.stringify({ status: task.status, at: task.updatedAt, detail }),
      );
  }
  events(id: string): TaskEvent[] {
    return this.db
      .prepare("SELECT body FROM events WHERE task_id=? ORDER BY seq")
      .all(id)
      .map((r) => JSON.parse(String(r.body)));
  }
  transition(
    id: string,
    status: TaskStatus,
    patch: Partial<Pick<Task, "result" | "error">> = {},
    detail?: string,
  ): Task {
    const task = this.get(id);
    if (!task) throw new Error("Task not found");
    if (terminalStatuses.includes(task.status)) return task;
    if (!ALLOWED_TRANSITIONS[task.status]?.includes(status))
      throw new Error(`Invalid transition ${task.status} -> ${status}`);
    const now = new Date().toISOString();
    const updated: Task = {
      ...task,
      ...patch,
      status,
      updatedAt: now,
      ...(status === "RUNNING" ? { startedAt: now } : {}),
      ...(terminalStatuses.includes(status) ? { finishedAt: now } : {}),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db
        .prepare("UPDATE tasks SET body=?,status=? WHERE id=? AND status=?")
        .run(JSON.stringify(updated), status, id, task.status);
      if (!changed.changes)
        throw new ConflictError("Task changed concurrently");
      this.recordEvent(updated, detail);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return updated;
  }
  next(): Task | undefined {
    const row = this.db
      .prepare(
        "SELECT body FROM tasks WHERE status='QUEUED' ORDER BY created,id LIMIT 1",
      )
      .get();
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  recover() {
    // Never replay a potentially billable request after an ambiguous crash.
    for (const row of this.db
      .prepare(
        `SELECT id FROM tasks WHERE status IN (${RECOVERABLE_STATUSES.map(() => "?").join(",")})`,
      )
      .all(...RECOVERABLE_STATUSES))
      this.transition(
        String(row.id),
        "FAILED",
        {
          error: {
            code: "WORKER_RESTARTED",
            message:
              "Worker stopped during execution. Submit a new task after reviewing provider activity.",
          },
        },
        "Interrupted execution; not replayed",
      );
  }
  putArtifact(
    data: Buffer,
    mime: string,
    source: string,
    kind: Artifact["kind"] = "text",
  ): Artifact {
    const id = createHash("sha256").update(data).digest("hex");
    const existing = this.artifact(id);
    if (existing) return existing;
    const artifact: Artifact = {
      id,
      mime,
      bytes: data.length,
      createdAt: new Date().toISOString(),
      source,
      kind,
    };
    const path = join(this.directory, "artifacts", id);
    if (!existsSync(path))
      writeFileSync(path, data, { mode: 0o600, flag: "wx" });
    this.db
      .prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?)")
      .run(id, JSON.stringify(artifact));
    return artifact;
  }
  artifact(id: string): Artifact | undefined {
    if (!ARTIFACT_ID_PATTERN.test(id)) return undefined;
    const row = this.db
      .prepare("SELECT body FROM artifacts WHERE id=?")
      .get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  artifactData(id: string): Buffer {
    if (!this.artifact(id)) throw new Error("Artifact not found");
    const data = readFileSync(join(this.directory, "artifacts", id));
    if (createHash("sha256").update(data).digest("hex") !== id)
      throw new Error("Artifact integrity check failed");
    return data;
  }
  metrics(hours = 24) {
    const since = windowStart(hours);
    const rows = this.db
      .prepare(
        `SELECT status, json_extract(body,'$.createdAt') AS createdAt, json_extract(body,'$.startedAt') AS startedAt, json_extract(body,'$.finishedAt') AS finishedAt, json_extract(body,'$.error.code') AS errorCode FROM tasks WHERE created >= ?`,
      )
      .all(since);
    const outcomes: Record<string, number> = {};
    const errors: Record<string, number> = Object.create(null);
    const queue: number[] = [],
      execution: number[] = [],
      total: number[] = [];
    for (const row of rows) {
      const status = String(row.status);
      outcomes[status] = (outcomes[status] ?? 0) + 1;
      if (row.errorCode) {
        const code = String(row.errorCode);
        errors[code] = (errors[code] ?? 0) + 1;
      }
      const queueMs = elapsed(row.createdAt, row.startedAt);
      if (queueMs !== undefined) queue.push(queueMs);
      const executionMs = elapsed(row.startedAt, row.finishedAt);
      if (executionMs !== undefined) execution.push(executionMs);
      const totalMs = elapsed(row.createdAt, row.finishedAt);
      if (totalMs !== undefined) total.push(totalMs);
    }
    const completed = outcomes.COMPLETED ?? 0;
    const terminalNonCancelled = [
      "COMPLETED",
      "FAILED",
      "NEEDS_AUTH",
      "NEEDS_HUMAN",
      "BLOCKED_BY_PROVIDER",
    ].reduce((sum, status) => sum + (outcomes[status] ?? 0), 0);
    return {
      since,
      windowHours: hours,
      generatedAt: new Date().toISOString(),
      tasks: rows.length,
      outcomes,
      completed,
      terminalNonCancelled,
      successRate: terminalNonCancelled
        ? completed / terminalNonCancelled
        : null,
      duration: {
        queue: durationSummary(queue),
        execution: durationSummary(execution),
        total: durationSummary(total),
      },
      errors,
    };
  }
  failures(limit = 20, hours = 24) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Error limit must be between 1 and 100");
    const since = windowStart(hours);
    return this.db
      .prepare(
        `SELECT id, status, json_extract(body,'$.error.code') AS code, json_extract(body,'$.createdAt') AS createdAt, json_extract(body,'$.finishedAt') AS finishedAt FROM tasks WHERE created >= ? AND json_extract(body,'$.error.code') IS NOT NULL ORDER BY created DESC,id DESC LIMIT ?`,
      )
      .all(since, limit)
      .map((row) => ({
        id: String(row.id),
        status: String(row.status),
        code: String(row.code),
        createdAt: String(row.createdAt),
        finishedAt: row.finishedAt ? String(row.finishedAt) : undefined,
      }));
  }
  close() {
    this.db.close();
  }
}
