import { afterEach, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { inspectReadiness, waitForSignIn } from "../src/browser-onboarding.js";
function fixture(ready: boolean) {
  const page = {
    url: () => "https://chatgpt.com/",
    evaluate: vi.fn(async (arg: unknown) =>
      typeof arg === "string" ? undefined : { ready },
    ),
  } as unknown as Page;
  const handlers = new Map<string, () => void>();
  const context = {
    pages: () => [page],
    on: (name: string, fn: () => void) => handlers.set(name, fn),
    off: (name: string) => handlers.delete(name),
  } as unknown as BrowserContext;
  return { context, handlers };
}
afterEach(() => vi.useRealTimers());
it("requires stable signed-in readiness and removes close listener", async () => {
  vi.useFakeTimers();
  const { context, handlers } = fixture(true);
  const done = waitForSignIn(context, "engine");
  await vi.advanceTimersByTimeAsync(2100);
  await done;
  expect(handlers.size).toBe(0);
});
it("reports a closed login window as cancellation", async () => {
  vi.useFakeTimers();
  const { context, handlers } = fixture(false);
  const done = waitForSignIn(context, "engine");
  const assertion = expect(done).rejects.toMatchObject({
    code: "LOGIN_CANCELLED",
  });
  handlers.get("close")!();
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
  expect(handlers.size).toBe(0);
});
it("bounds sign-in duration without accepting an unsigned composer", async () => {
  vi.useFakeTimers();
  const { context } = fixture(false);
  const done = waitForSignIn(context, "engine", 2000);
  const assertion = expect(done).rejects.toMatchObject({
    code: "LOGIN_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(2000);
  await assertion;
});

it("preserves headless challenge details instead of reducing them to false", async () => {
  const problem = {
    ready: false,
    error: {
      code: "BROWSER_CHALLENGE",
      message: "Manual verification required",
      status: "NEEDS_HUMAN",
    },
  };
  const page = {
    url: () => "https://chatgpt.com/",
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(problem),
  } as unknown as Page;
  expect(await inspectReadiness(page, "engine")).toEqual(problem);
});
it("reports sign-in redirects without injecting the engine on another origin", async () => {
  const evaluate = vi.fn();
  const page = {
    url: () => "https://auth.openai.com/",
    evaluate,
  } as unknown as Page;
  expect(await inspectReadiness(page, "engine")).toMatchObject({
    ready: false,
    error: { code: "LOGIN_REDIRECT", status: "NEEDS_AUTH" },
  });
  expect(evaluate).not.toHaveBeenCalled();
});
