import { ProviderError } from "@chatgpt-wrapper/adapters";
import {
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  type TaskRequest,
} from "@chatgpt-wrapper/contracts";
import type { Page } from "playwright";
import { isAbsolute, sep } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/** MCP clients can request work but must not read arbitrary local files. */
export async function validateImagePath(path: string): Promise<string> {
  const roots = (process.env.IMAGE_INPUT_ROOTS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!roots.length || !isAbsolute(path))
    throw new ProviderError(
      "IMAGE_PATH_NOT_ALLOWED",
      "Local image paths require an absolute path and explicit IMAGE_INPUT_ROOTS configuration.",
    );
  const realPath = await realpath(path);
  const file = await stat(realPath);
  if (!file.isFile() || file.size > MAX_IMAGE_BYTES)
    throw new ProviderError(
      "IMAGE_PATH_NOT_ALLOWED",
      "Image input must be a regular file at most 10 MiB.",
    );
  for (const root of roots) {
    if (!isAbsolute(root)) continue;
    const realRoot = await realpath(root).catch(() => undefined);
    if (
      realRoot &&
      (realPath === realRoot || realPath.startsWith(realRoot + sep))
    )
      return realPath;
  }
  throw new ProviderError(
    "IMAGE_PATH_NOT_ALLOWED",
    "Image path is outside configured IMAGE_INPUT_ROOTS (symlinks are resolved).",
  );
}

/** Remote downloads are disabled unless their exact trusted hostname is configured. */
export function validateImageUrl(input: string): URL {
  const url = new URL(input);
  const allowed = (process.env.ALLOWED_IMAGE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !allowed.includes(url.hostname.toLowerCase())
  )
    throw new ProviderError(
      "IMAGE_URL_NOT_ALLOWED",
      "HTTPS image downloads require an exact hostname in ALLOWED_IMAGE_HOSTS.",
    );
  return url;
}
export type GeneratedImage = { src: string; mime?: string };

type UploadFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

export async function resolveImageInput(
  input: TaskRequest["images"][number],
  signal?: AbortSignal,
): Promise<UploadFile> {
  signal?.throwIfAborted();
  if (input.source === "path") {
    const safePath = await validateImagePath(input.path);
    const buffer = await readFile(safePath, { signal });
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new ProviderError("IMAGE_TOO_LARGE", "Local image exceeds 10 MiB.");
    return {
      name: safePath.split(sep).at(-1) || "image",
      mimeType: imageMime(safePath),
      buffer,
    };
  }
  if (input.source === "base64") {
    const buffer = Buffer.from(input.data, "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES)
      throw new ProviderError(
        "IMAGE_TOO_LARGE",
        `Base64 image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit.`,
      );
    return { name: input.name, mimeType: input.mime, buffer };
  }
  const url = validateImageUrl(input.url);
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new ProviderError(
      "IMAGE_DOWNLOAD_FAILED",
      `Could not download image (HTTP ${response.status}).`,
    );
  const mimeType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.toLowerCase();
  if (!mimeType || !ALLOWED_IMAGE_MIMES.has(mimeType))
    throw new ProviderError(
      "IMAGE_TYPE_UNSUPPORTED",
      "Remote URL did not return a supported image.",
    );
  if (!response.body)
    throw new ProviderError(
      "IMAGE_DOWNLOAD_FAILED",
      "Remote image response has no body.",
    );
  // Enforce the limit during streaming, rather than allocating an unbounded arrayBuffer.
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ProviderError(
          "IMAGE_TOO_LARGE",
          "Remote image exceeds 10 MiB.",
        );
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return {
    name: url.pathname.split("/").at(-1) || "image",
    mimeType,
    buffer: Buffer.concat(chunks, total),
  };
}

export async function uploadImages(
  page: Page,
  inputs: TaskRequest["images"] | undefined,
  signal?: AbortSignal,
): Promise<Array<{ source: "path" | "base64" | "url"; name: string }>> {
  if (!inputs?.length) return [];
  const files: UploadFile[] = [];
  let totalBytes = 0;
  for (const input of inputs) {
    const file = await resolveImageInput(input, signal);
    totalBytes += file.buffer.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES)
      throw new ProviderError(
        "IMAGE_INPUTS_TOO_LARGE",
        "Combined image inputs exceed 20 MiB.",
      );
    files.push(file);
  }
  signal?.throwIfAborted();
  const attachmentButton = page
    .locator(
      [
        'button[aria-label*="attach" i]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="add file" i]',
        'button[data-testid*="attach" i]',
        'button[data-testid*="upload" i]',
        'button[data-testid*="file" i]',
        '[role="button"][aria-label*="attach" i]',
        '[role="button"][aria-label*="upload" i]',
        '[role="button"][aria-label*="add file" i]',
        'label[for*="file" i]',
      ].join(", "),
    )
    .first();
  if ((await attachmentButton.count()) && (await attachmentButton.isVisible()))
    await attachmentButton.click();

  const fileInputs = page.locator('input[type="file"]');
  if (!(await fileInputs.count()))
    throw new ProviderError(
      "IMAGE_UPLOAD_UNAVAILABLE",
      "ChatGPT did not expose an image upload control.",
      "NEEDS_HUMAN",
    );
  let fileInput = fileInputs.first();
  for (let index = 0; index < (await fileInputs.count()); index++) {
    const candidate = fileInputs.nth(index);
    const accept = (await candidate.getAttribute("accept")) ?? "";
    if (accept.includes("image")) {
      fileInput = candidate;
      break;
    }
  }
  await fileInput.setInputFiles(files);
  await page.waitForTimeout(500);
  return files.map((file) => ({ source: "path", name: file.name }));
}

export async function downloadImages(
  page: Page,
  images: GeneratedImage[] = [],
) {
  return Promise.all(
    images.map(async (image) => {
      const result = await page.evaluate(
        async ({ src, maxBytes }) => {
          const response = await fetch(src);
          if (!response.ok)
            throw new Error(`Image download failed: ${response.status}`);
          if (!response.body) throw new Error("Image response has no body");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              total += chunk.value.byteLength;
              if (total > maxBytes) {
                await reader.cancel();
                throw new Error("Image exceeds 10 MiB");
              }
              chunks.push(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(total);
          let position = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, position);
            position += chunk.byteLength;
          }
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000)
            binary += String.fromCharCode(
              ...bytes.subarray(offset, offset + 0x8000),
            );
          return {
            data: btoa(binary),
            mime: response.headers.get("content-type") ?? undefined,
          };
        },
        { src: image.src, maxBytes: MAX_IMAGE_BYTES },
      );
      return {
        data: Buffer.from(result.data, "base64"),
        mime: image.mime ?? result.mime ?? "image/png",
        source: "chatgpt-playwright",
      };
    }),
  );
}

function imageMime(path: string): string {
  const extension = path.toLowerCase().split(".").at(-1);
  const mime = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  }[extension ?? ""];
  if (!mime)
    throw new ProviderError(
      "IMAGE_TYPE_UNSUPPORTED",
      "Image paths must use avif, gif, jpeg, jpg, png, or webp.",
    );
  return mime;
}
