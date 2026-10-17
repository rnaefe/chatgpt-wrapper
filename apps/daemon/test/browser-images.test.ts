import { afterEach, expect, it, vi } from "vitest";
import { resolveImageInput } from "../src/browser-images.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("aborts an in-flight image download when the task is cancelled", async () => {
  vi.stubEnv("ALLOWED_IMAGE_HOSTS", "images.example");
  const controller = new AbortController();
  const failure = new Error("cancelled by client");
  const fetch = vi.fn(
    (_url, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = resolveImageInput(
    { source: "url", url: "https://images.example/reference.png" },
    controller.signal,
  );
  controller.abort(failure);
  await expect(pending).rejects.toBe(failure);
  expect(fetch).toHaveBeenCalledOnce();
});

it("cancels oversized remote streams instead of buffering the entire response", async () => {
  vi.stubEnv("ALLOWED_IMAGE_HOSTS", "images.example");
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, { headers: { "content-type": "image/png" } }),
    ),
  );
  await expect(
    resolveImageInput({
      source: "url",
      url: "https://images.example/reference.png",
    }),
  ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects already-cancelled tasks before resolving any image input", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  await expect(
    resolveImageInput(
      { source: "path", path: "/does-not-exist.png" },
      controller.signal,
    ),
  ).rejects.toThrow("stopped");
});
