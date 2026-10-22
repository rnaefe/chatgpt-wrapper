import { ProviderError } from "@chatgpt-wrapper/adapters";
import type { FileInput, TaskRequest } from "@chatgpt-wrapper/contracts";
import type { Page } from "playwright";
import { basename, extname, isAbsolute, sep } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolveImageInput } from "./browser-images.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_EXTENSIONS = new Set(
  "txt md csv json ts tsx js jsx py go rs java c cpp h swift css html sql yaml yml toml xml sh vue svelte".split(
    " ",
  ),
);
type UploadFile = { name: string; mimeType: string; buffer: Buffer };

/** Existing draft attachments belong to the user and must never be sent implicitly. */
export async function assertNoPendingAttachments(page: Page): Promise<void> {
  // Older adapter test doubles do not implement browser selectors.
  if (typeof page.locator !== "function") return;
  const cards = page.locator(
    '[data-composer-attachments] [class~="group/composer-attachment"], form [data-testid*="attachment" i], form [data-testid*="file-upload" i]',
  );
  for (let index = 0; index < (await cards.count()); index++) {
    if (await cards.nth(index).isVisible())
      throw new ProviderError(
        "UNSENT_ATTACHMENTS",
        "The composer already contains unsent attachments. Review them in the browser before continuing.",
        "NEEDS_HUMAN",
      );
  }
}

function fail(code: string, message: string): never {
  throw new ProviderError(code, message);
}
function mimeFor(name: string): string {
  const extension = extname(name).slice(1).toLowerCase();
  if (name.startsWith(".") || !extension)
    return fail(
      "FILE_TYPE_UNSUPPORTED",
      "Attachment filename must have a supported extension.",
    );
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return DOCX;
  if (TEXT_EXTENSIONS.has(extension))
    return extension === "json" ? "application/json" : "text/plain";
  return fail("FILE_TYPE_UNSUPPORTED", "Attachment type is unsupported.");
}
function validateBytes(file: UploadFile): UploadFile {
  if (file.buffer.length > MAX_BYTES)
    fail("FILE_TOO_LARGE", "Attachment exceeds 10 MiB.");
  if (
    file.mimeType === "application/pdf" &&
    file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    fail("FILE_CONTENT_INVALID", "PDF attachment has an invalid header.");
  if (
    file.mimeType === DOCX &&
    !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  )
    fail("FILE_CONTENT_INVALID", "DOCX attachment has an invalid ZIP header.");
  return file;
}

export async function resolveFileInput(
  input: FileInput,
  signal?: AbortSignal,
): Promise<UploadFile> {
  signal?.throwIfAborted();
  if (input.source === "path") {
    const roots = (process.env.FILE_INPUT_ROOTS ?? "")
      .split(",")
      .map((root) => root.trim())
      .filter((root) => root && isAbsolute(root));
    if (!isAbsolute(input.path) || !roots.length)
      fail(
        "FILE_PATH_NOT_ALLOWED",
        "Local attachments require an absolute path and explicit FILE_INPUT_ROOTS configuration.",
      );
    // Validate the requested name as well as the resolved name, including hidden files.
    mimeFor(basename(input.path));
    let safePath: string;
    try {
      safePath = await realpath(input.path);
    } catch {
      return fail("FILE_PATH_NOT_ALLOWED", "Attachment path cannot be read.");
    }
    const resolvedRoots = await Promise.all(
      roots.map((root) => realpath(root).catch(() => undefined)),
    );
    if (
      !resolvedRoots.some(
        (root) =>
          root &&
          (safePath === root ||
            safePath.startsWith(root.endsWith(sep) ? root : root + sep)),
      )
    )
      fail(
        "FILE_PATH_NOT_ALLOWED",
        "Attachment path is outside configured FILE_INPUT_ROOTS.",
      );
    const info = await stat(safePath).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_BYTES)
      fail(
        "FILE_PATH_NOT_ALLOWED",
        "Attachment must be a regular file at most 10 MiB.",
      );
    const name = basename(safePath);
    const mimeType = mimeFor(name);
    signal?.throwIfAborted();
    let buffer: Buffer;
    try {
      buffer = await readFile(safePath, { signal });
    } catch {
      signal?.throwIfAborted();
      return fail("FILE_READ_FAILED", "Attachment file could not be read.");
    }
    signal?.throwIfAborted();
    return validateBytes({ name, mimeType, buffer });
  }
  if (!input.name || /[/\\\x00-\x1f\x7f]/.test(input.name))
    fail(
      "FILE_NAME_INVALID",
      "Attachment name must be a basename without control characters.",
    );
  const mimeType = mimeFor(input.name);
  const supplied = input.mime.toLowerCase();
  const isText = mimeType === "text/plain" || mimeType === "application/json";
  if (
    isText
      ? !(
          /^text\/[a-z0-9.+-]+$/.test(supplied) ||
          (extname(input.name).toLowerCase() === ".json" &&
            supplied === "application/json")
        )
      : supplied !== mimeType
  )
    fail(
      "FILE_TYPE_UNSUPPORTED",
      "Attachment MIME type does not match its extension.",
    );
  if (input.data.length > Math.ceil(MAX_BYTES / 3) * 4)
    fail("FILE_TOO_LARGE", "Attachment exceeds 10 MiB.");
  const unpadded = input.data.replace(/={1,2}$/, "");
  if (
    /[^A-Za-z0-9+/]/.test(unpadded) ||
    unpadded.length % 4 === 1 ||
    (input.data !== unpadded && input.data.length % 4 !== 0)
  )
    fail(
      "FILE_BASE64_INVALID",
      "Attachment must contain valid standard base64.",
    );
  const buffer = Buffer.from(input.data, "base64");
  if (
    buffer.toString("base64").replace(/=+$/, "") !==
    input.data.replace(/=+$/, "")
  )
    fail("FILE_BASE64_INVALID", "Attachment must contain canonical base64.");
  signal?.throwIfAborted();
  return validateBytes({ name: input.name, mimeType, buffer });
}

function accepts(accept: string, files: UploadFile[]): boolean {
  const tokens = accept
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    !tokens.length ||
    files.every((file) =>
      tokens.some(
        (token) =>
          token === "*" ||
          token === "*/*" ||
          token === file.mimeType ||
          token === extname(file.name).toLowerCase() ||
          (token.endsWith("/*") &&
            file.mimeType.startsWith(token.slice(0, -1))),
      ),
    )
  );
}

export async function uploadAttachments(
  page: Page,
  images: TaskRequest["images"] | undefined,
  inputs: FileInput[] | undefined,
  signal?: AbortSignal,
): Promise<{
  images: Array<{ source: "path"; name: string }>;
  files: Array<{ name: string }>;
}> {
  signal?.throwIfAborted();
  if ((images?.length ?? 0) + (inputs?.length ?? 0) > 8)
    fail("ATTACHMENT_COUNT_EXCEEDED", "At most 8 attachments are supported.");
  const files: UploadFile[] = [];
  let total = 0;
  for (const input of images ?? []) {
    const file = await resolveImageInput(input, signal);
    total += file.buffer.length;
    if (total > MAX_TOTAL_BYTES)
      fail(
        "ATTACHMENT_INPUTS_TOO_LARGE",
        "Combined attachments exceed 20 MiB.",
      );
    files.push(file);
  }
  for (const input of inputs ?? []) {
    const file = await resolveFileInput(input, signal);
    total += file.buffer.length;
    if (total > MAX_TOTAL_BYTES)
      fail(
        "ATTACHMENT_INPUTS_TOO_LARGE",
        "Combined attachments exceed 20 MiB.",
      );
    files.push(file);
  }
  if (!files.length) return { images: [], files: [] };
  signal?.throwIfAborted();
  const buttons = page.locator(
    'button[aria-label*="attach" i], button[aria-label*="upload" i], button[aria-label*="add file" i], button[data-testid*="attach" i], button[data-testid*="upload" i], button[data-testid*="file" i], [role="button"][aria-label*="attach" i], [role="button"][aria-label*="upload" i], [role="button"][aria-label*="add file" i], label[for*="file" i]',
  );
  for (let index = 0; index < (await buttons.count()); index++) {
    if (await buttons.nth(index).isVisible()) {
      await buttons.nth(index).click();
      break;
    }
  }
  const candidates = page.locator('input[type="file"]');
  let selected: ReturnType<Page["locator"]> | undefined;
  for (let index = 0; index < (await candidates.count()); index++) {
    const candidate = candidates.nth(index);
    const accept = (await candidate.getAttribute("accept")) ?? "";
    if (inputs?.length) {
      if (accepts(accept, files)) {
        selected = candidate;
        break;
      }
    } else {
      selected ??= candidate;
      if (accept.includes("image")) {
        selected = candidate;
        break;
      }
    }
  }
  if (!selected)
    throw new ProviderError(
      "ATTACHMENT_UPLOAD_UNAVAILABLE",
      "ChatGPT did not expose a compatible attachment upload control.",
      "NEEDS_HUMAN",
    );
  signal?.throwIfAborted();
  const chipSelector =
    '[data-testid*="attachment" i], [data-testid*="file-upload" i], [data-composer-attachments] [class~="group/composer-attachment"]';
  const chipCounts = async () => {
    const counts = new Map<string, number>();
    const chips = page.locator(chipSelector);
    for (let index = 0; index < (await chips.count()); index++) {
      const chip = chips.nth(index);
      if (!(await chip.isVisible())) continue;
      // Count outer chips only: nested matching wrappers must not confirm duplicates.
      if (
        await chip.evaluate(
          (element, selector) => !!element.parentElement?.closest(selector),
          chipSelector,
        )
      )
        continue;
      const text = await chip.innerText();
      if (
        /\b(upload failed|failed to upload|upload error|could not upload)\b/i.test(
          text,
        )
      )
        fail(
          "ATTACHMENT_UPLOAD_FAILED",
          "The attachment control reported an upload error.",
        );
      const labels = await chip.evaluate((element) =>
        Array.from(element.querySelectorAll("button[aria-label]"), (button) =>
          (button.getAttribute("aria-label") ?? "")
            .replace(/^Remove\s+/i, "")
            .trim(),
        ),
      );
      const rendered = [
        ...new Set([
          ...labels,
          ...text.split(/[\r\n]+/).map((line) => line.trim()),
        ]),
      ].filter((name) => name.length > 0 && name.length <= 220);
      const requested = [...new Set(files.map((file) => file.name))];
      const exact = requested.filter((name) => rendered.includes(name));
      const aliases = exact.length
        ? exact
        : requested.filter((name) => {
            const extension = extname(name);
            const stem = name.slice(0, -extension.length);
            return rendered.some(
              (actual) =>
                actual.startsWith(stem) &&
                actual.endsWith(extension) &&
                /^ ?\([1-9]\d*\)$/.test(
                  actual.slice(stem.length, -extension.length),
                ),
            );
          });
      // A chip confirms one canonical file only. Ambiguous aliases fail closed.
      if (aliases.length === 1) {
        const name = aliases[0];
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  };
  const baseline = await chipCounts();
  await selected.setInputFiles(files);
  const names = await selected.evaluate((element) =>
    Array.from((element as HTMLInputElement).files ?? [], (file) => file.name),
  );
  const confirmedInput =
    names.length === files.length &&
    names.every((name, index) => name === files[index].name);
  // Give change handlers a turn, then wait for explicit upload activity to finish.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const deadline = Date.now() + 15_000;
  const uploadScope = `:is([data-composer-attachments], ${chipSelector})`;
  for (;;) {
    signal?.throwIfAborted();
    const activity = page.locator(
      `${uploadScope} :is([aria-busy="true"], [role="progressbar"], progress), ${uploadScope}[aria-busy="true"], ${uploadScope}[role="progressbar"]`,
    );
    let busy = false;
    for (let index = 0; index < (await activity.count()); index++)
      if (await activity.nth(index).isVisible()) {
        busy = true;
        break;
      }
    const counts = await chipCounts();
    const required = new Map<string, number>();
    for (const file of files)
      required.set(file.name, (required.get(file.name) ?? 0) + 1);
    const confirmedChips = [...required].every(
      ([name, count]) =>
        (counts.get(name) ?? 0) - (baseline.get(name) ?? 0) >= count,
    );
    if (!busy && (confirmedInput || confirmedChips)) break;
    if (Date.now() >= deadline)
      fail(
        "ATTACHMENT_UPLOAD_FAILED",
        "Attachment upload did not finish in time.",
      );
    await page.waitForTimeout(100);
  }
  signal?.throwIfAborted();
  return {
    images: files
      .slice(0, images?.length ?? 0)
      .map((file) => ({ source: "path", name: file.name })),
    files: files
      .slice(images?.length ?? 0)
      .map((file) => ({ name: file.name })),
  };
}
