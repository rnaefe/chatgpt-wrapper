import { expect, it } from "vitest";
import { inspectProbe } from "../src/browser-verification.js";
import { assertSafeStop, stopWorker } from "../src/worker-control.js";
import type { Task } from "@chatgpt-wrapper/contracts";
const task = {
  id: "test",
  status: "COMPLETED",
  request: {
    capability: "code.generate",
    objective: "test",
    acceptanceCriteria: [],
    allowedPaths: [],
    timeoutSeconds: 30,
  },
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:01Z",
} as Task;
it("requires both completion and exact fenced output for a live PASS", () => {
  const success = {
    ...task,
    result: {
      text: "```typescript\nexport const probe = true;\n```",
      artifacts: [],
      provenance: { adapter: "fixture", model: "fixture" },
      validation: { passed: true, checks: [] },
    },
  };
  expect(
    inspectProbe(success, "export const probe = true;", 1000),
  ).toMatchObject({
    outcome: "PASS",
    durationMs: 1000,
    checks: { completed: true, expectedCode: true, codeFence: true },
  });
  expect(
    inspectProbe(
      {
        ...success,
        result: { ...success.result, text: "export const probe = true;" },
      },
      "export const probe = true;",
      1000,
    ).outcome,
  ).toBe("FAIL");
  expect(inspectProbe(success, "different code", 1000).outcome).toBe("FAIL");
});
it.each(["NEEDS_AUTH", "NEEDS_HUMAN", "BLOCKED_BY_PROVIDER"] as const)(
  "records %s as blocked rather than successful",
  (status) => {
    expect(
      inspectProbe(
        {
          ...task,
          status,
          error: { code: "PROVIDER_BLOCK", message: "fixture" },
        },
        "probe",
        100,
      ),
    ).toMatchObject({ outcome: "BLOCKED", errorCode: "PROVIDER_BLOCK" });
  },
);
it("does not stop a mismatched worker or one with queued or active work", () => {
  expect(() =>
    assertSafeStop(123, { runtime: { pid: 999 }, counts: {} }),
  ).toThrow("does not match");
  for (const state of ["QUEUED", "RUNNING", "VALIDATING"])
    expect(() =>
      assertSafeStop(123, { runtime: { pid: 123 }, counts: { [state]: 1 } }),
    ).toThrow("unfinished tasks");
  expect(() => assertSafeStop(123, { runtime: { pid: 123 } })).toThrow(
    "queue state",
  );
  expect(() =>
    assertSafeStop(123, { runtime: { pid: 123 }, counts: { COMPLETED: 10 } }),
  ).not.toThrow();
});
it("rejects non-loopback stop targets before reading a private token", async () => {
  await expect(
    stopWorker("/does-not-exist", "https://external.example"),
  ).rejects.toThrow("loopback");
});
it("does not accept the expected source outside a different fenced block", () => {
  const result = {
    text: "export const probe = true;\n```typescript\nwrong();\n```",
    artifacts: [],
    provenance: { adapter: "fixture", model: "fixture" },
    validation: { passed: true, checks: [] },
  };
  expect(
    inspectProbe({ ...task, result }, "export const probe = true;", 100)
      .outcome,
  ).toBe("FAIL");
});
