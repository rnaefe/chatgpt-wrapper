import { afterEach, expect, it, vi } from "vitest";
import {
  downloadImages,
  resolveImageInput,
  uploadImages,
} from "../src/browser-images.js";
import type { Page } from "playwright";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("rejects combined attachments before touching the browser upload control", async () => {
  const page = { locator: vi.fn() } as unknown as Page;
  const image = {
    source: "base64" as const,
    data: Buffer.alloc(7 * 1024 * 1024).toString("base64"),
    mime: "image/png",
    name: "reference.png",
  };
  await expect(uploadImages(page, [image, image, image])).rejects.toMatchObject(
    {
      code: "IMAGE_INPUTS_TOO_LARGE",
    },
  );
  expect(page.locator).not.toHaveBeenCalled();
});

// Run the actual serialized browser callback against controlled response streams.
const imagePage = () =>
  ({
    evaluate: (callback: (argument: unknown) => unknown, argument: unknown) =>
      callback(argument),
  }) as unknown as Page;

it("cancels oversized generated-image streams before reading the remainder", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body)),
  );
  await expect(
    downloadImages(imagePage(), [{ src: "blob:generated" }]),
  ).rejects.toThrow("Image exceeds 10 MiB");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("preserves generated-image bytes across stream chunk boundaries", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 128, 255]));
      controller.enqueue(new Uint8Array([1, 2]));
      controller.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, { headers: { "content-type": "image/png" } }),
    ),
  );
  const images = await downloadImages(imagePage(), [{ src: "blob:generated" }]);
  expect(images[0].data).toEqual(Buffer.from([0, 128, 255, 1, 2]));
  expect(images[0].mime).toBe("image/png");
  expect(body.locked).toBe(false);
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
