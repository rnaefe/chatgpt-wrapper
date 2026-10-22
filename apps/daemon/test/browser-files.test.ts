import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import {
  assertNoPendingAttachments,
  resolveFileInput,
  uploadAttachments,
} from "../src/browser-files.js";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
const directories: string[] = [];
afterEach(async () => {
  vi.mocked(readFile).mockClear();
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("redacts filesystem read errors and preserves cancellation reasons", async () => {
  const root = await directory();
  const path = join(root, "private-source.ts");
  await writeFile(path, "export {};");
  vi.stubEnv("FILE_INPUT_ROOTS", root);
  vi.mocked(readFile).mockRejectedValueOnce(
    new Error(`EACCES: permission denied, open '${path}'`),
  );
  const failure = await resolveFileInput({ source: "path", path }).catch(
    (error) => error,
  );
  expect(failure).toMatchObject({
    code: "FILE_READ_FAILED",
    message: "Attachment file could not be read.",
  });
  expect(failure.message).not.toContain(path);
  const controller = new AbortController();
  const reason = new Error("cancelled during read");
  vi.mocked(readFile).mockImplementationOnce(async () => {
    controller.abort(reason);
    throw new Error(`ENOENT: '${path}'`);
  });
  await expect(
    resolveFileInput({ source: "path", path }, controller.signal),
  ).rejects.toBe(reason);
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "attachments-"));
  directories.push(path);
  return path;
}
const text = (data = "hello", name = "source.ts") => ({
  source: "base64" as const,
  name,
  data: Buffer.from(data).toString("base64"),
  mime: "text/plain",
});
it("resolves allowed project files and rejects escaping symlinks, directories and oversized files", async () => {
  const root = await directory();
  const outside = await directory();
  vi.stubEnv("FILE_INPUT_ROOTS", root);
  await writeFile(join(root, "source.ts"), "export {};");
  expect(
    (
      await resolveFileInput({ source: "path", path: join(root, "source.ts") })
    ).buffer.toString(),
  ).toBe("export {};");
  await writeFile(join(outside, "outside.ts"), "secret");
  await symlink(join(outside, "outside.ts"), join(root, "link.ts"));
  await expect(
    resolveFileInput({ source: "path", path: join(root, "link.ts") }),
  ).rejects.toMatchObject({ code: "FILE_PATH_NOT_ALLOWED" });
  await expect(
    resolveFileInput({ source: "path", path: root }),
  ).rejects.toThrow();
  await writeFile(join(root, "large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1));
  await expect(
    resolveFileInput({ source: "path", path: join(root, "large.txt") }),
  ).rejects.toThrow();
});
it("validates names, types, signatures and canonical base64 before upload", async () => {
  for (const name of [
    "../file.ts",
    "bad\\file.ts",
    "bad\n.ts",
    ".env",
    "run.exe",
    "archive.zip",
  ])
    await expect(resolveFileInput(text("hello", name))).rejects.toThrow();
  for (const data of ["a", "a===", "aGVsbG8=\n", "Zh==", "!!!!"])
    await expect(resolveFileInput({ ...text(), data })).rejects.toMatchObject({
      code: "FILE_BASE64_INVALID",
    });
  expect(
    (await resolveFileInput({ ...text(), data: "aGk" })).buffer.toString(),
  ).toBe("hi");
  await expect(
    resolveFileInput({ ...text(), mime: "application/pdf" }),
  ).rejects.toThrow();
  await expect(
    resolveFileInput({
      ...text("invalid", "file.pdf"),
      mime: "application/pdf",
    }),
  ).rejects.toMatchObject({ code: "FILE_CONTENT_INVALID" });
  expect(
    (
      await resolveFileInput({
        ...text("%PDF-1.7", "file.pdf"),
        mime: "application/pdf",
      })
    ).mimeType,
  ).toBe("application/pdf");
  await expect(
    resolveFileInput({
      ...text("no", "file.docx"),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  ).rejects.toMatchObject({ code: "FILE_CONTENT_INVALID" });
});
it("checks cancellation, combined count and decoded bytes before browser interaction", async () => {
  const page = { locator: vi.fn() } as unknown as Page;
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(resolveFileInput(text(), controller.signal)).rejects.toThrow(
    "cancelled",
  );
  await expect(
    uploadAttachments(
      page,
      [],
      Array.from({ length: 9 }, () => text()),
    ),
  ).rejects.toMatchObject({ code: "ATTACHMENT_COUNT_EXCEEDED" });
  const image = {
    source: "base64" as const,
    name: "image.png",
    mime: "image/png",
    data: Buffer.alloc(7 * 1024 * 1024).toString("base64"),
  };
  await expect(
    uploadAttachments(
      page,
      [image],
      [text("x".repeat(7 * 1024 * 1024)), text("x".repeat(7 * 1024 * 1024))],
    ),
  ).rejects.toMatchObject({ code: "ATTACHMENT_INPUTS_TOO_LARGE" });
  expect(page.locator).not.toHaveBeenCalled();
});
it("uploads images and documents in one call through a compatible input", async () => {
  const upload = vi.fn();
  const imageInput = {
    getAttribute: async () => "image/*",
    setInputFiles: vi.fn(),
  };
  const mixedInput = {
    getAttribute: async () => ".pdf,image/*",
    setInputFiles: upload,
    evaluate: async () => ["image.png", "file.pdf"],
  };
  const empty = { count: async () => 0 };
  const candidates = {
    count: async () => 2,
    nth: (index: number) => [imageInput, mixedInput][index],
  };
  const page = {
    locator: (selector: string) =>
      selector === 'input[type="file"]' ? candidates : empty,
    evaluate: async () => {},
  } as unknown as Page;
  const result = await uploadAttachments(
    page,
    [{ source: "base64", name: "image.png", mime: "image/png", data: "aGk=" }],
    [{ ...text("%PDF-1.7", "file.pdf"), mime: "application/pdf" }],
  );
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0][0]).toHaveLength(2);
  expect(imageInput.setInputFiles).not.toHaveBeenCalled();
  expect(result.files).toEqual([{ name: "file.pdf" }]);
});

it("waits for scoped upload progress while ignoring unrelated persistent progress", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<aside aria-busy="true"><div role="progressbar">Unrelated activity</div><progress></progress></aside><div data-composer-attachments>Attachments</div><input type="file" accept="image/*" multiple><input id="mixed" type="file" accept="*/*" multiple><script>
      document.querySelector('#mixed').addEventListener('change', () => {
        const attachments = document.querySelector('[data-composer-attachments]');
        attachments.setAttribute('aria-busy', 'true');
        setTimeout(() => { attachments.removeAttribute('aria-busy'); document.body.dataset.finished = 'yes'; }, 150);
      });
    </script>`);
    const result = await uploadAttachments(
      page,
      [
        {
          source: "base64",
          name: "image.png",
          mime: "image/png",
          data: "aGk=",
        },
      ],
      [text()],
    );
    expect(result.files).toEqual([{ name: "source.ts" }]);
    expect(
      await page
        .locator("#mixed")
        .evaluate((element) =>
          Array.from(
            (element as HTMLInputElement).files ?? [],
            (file) => file.name,
          ),
        ),
    ).toEqual(["image.png", "source.ts"]);
    expect(await page.locator("body").getAttribute("data-finished")).toBe(
      "yes",
    );
    expect(await page.locator("aside").getAttribute("aria-busy")).toBe("true");
  } finally {
    await browser.close();
  }
});

it("confirms fresh scoped attachment chips when the provider clears FileList", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div data-testid="attachment-old">source.ts</div><input type="file" multiple><script>
      document.querySelector('input').addEventListener('change', event => {
        const names = Array.from(event.target.files, file => file.name);
        event.target.value = '';
        setTimeout(() => names.forEach(name => {
          const chip = document.createElement('div'); chip.dataset.testid = 'attachment-new'; chip.textContent = name; document.body.append(chip);
        }), 100);
      });
    </script>`);
    expect((await uploadAttachments(page, [], [text()])).files).toEqual([
      { name: "source.ts" },
    ]);
    expect(
      await page
        .locator("input")
        .evaluate((element) => (element as HTMLInputElement).files?.length),
    ).toBe(0);
    expect(await page.locator('[data-testid^="attachment"]').count()).toBe(2);
    await page.setContent(`<input type="file" multiple><script>
      document.querySelector('input').addEventListener('change', () => {
        const chip = document.createElement('div'); chip.dataset.testid = 'file-upload-error'; chip.textContent = 'Upload failed'; document.body.append(chip);
      });
    </script>`);
    await expect(uploadAttachments(page, [], [text()])).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_FAILED",
    });
  } finally {
    await browser.close();
  }
});

it("confirms observed composer attachment chips after FileList is cleared and upload finishes", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div data-composer-attachments data-visible-attachments><div></div></div><input type="file" multiple><script>
      document.querySelector('input').addEventListener('change', event => {
        const name = event.target.files[0].name;
        event.target.value = '';
        const chip = document.createElement('span');
        chip.className = 'group/composer-attachment relative block';
        const title = document.createElement('span'); title.textContent = name; chip.append(title);
        const remove = document.createElement('button'); remove.setAttribute('aria-label', 'Remove ' + name); chip.append(remove);
        const progress = document.createElement('div'); progress.style.cssText = 'width:20px;height:20px'; progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Uploading ' + name); chip.append(progress);
        document.querySelector('[data-composer-attachments] > div').append(chip);
        setTimeout(() => { progress.remove(); document.body.dataset.uploadFinished = 'yes'; }, 150);
      });
    </script>`);
    expect(
      (
        await uploadAttachments(
          page,
          [],
          [text("notes", "wrapper-live-notes.txt")],
        )
      ).files,
    ).toEqual([{ name: "wrapper-live-notes.txt" }]);
    expect(
      await page
        .locator("input")
        .evaluate((element) => (element as HTMLInputElement).files?.length),
    ).toBe(0);
    expect(
      await page.locator("body").getAttribute("data-upload-finished"),
    ).toBe("yes");
    expect(
      await page
        .getByRole("button", { name: "Remove wrapper-live-notes.txt" })
        .count(),
    ).toBe(1);
  } finally {
    await browser.close();
  }
});

it("protects existing draft attachments without mutating or sending the composer", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><div data-composer-attachments><span class="group/composer-attachment">private-draft.txt<button type="button" onclick="this.parentElement.remove()">Remove</button></span></div><textarea>Unsent user draft</textarea><button type="submit">Send</button></form><script>
      document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); document.body.dataset.sent = 'yes'; });
    </script>`);
    const before = await page.content();
    await expect(assertNoPendingAttachments(page)).rejects.toMatchObject({
      code: "UNSENT_ATTACHMENTS",
      status: "NEEDS_HUMAN",
    });
    expect(await page.content()).toBe(before);
    expect(await page.locator("textarea").inputValue()).toBe(
      "Unsent user draft",
    );
    expect(await page.locator("body").getAttribute("data-sent")).toBeNull();
    await page.setContent(
      '<article><div data-testid="attachment-history">previous.txt</div></article><form><div data-testid="file-upload-draft" hidden>hidden.txt</div></form>',
    );
    await expect(assertNoPendingAttachments(page)).resolves.toBeUndefined();
    await page
      .locator('[data-testid="file-upload-draft"]')
      .evaluate((element) => element.removeAttribute("hidden"));
    await expect(assertNoPendingAttachments(page)).rejects.toMatchObject({
      code: "UNSENT_ATTACHMENTS",
    });
    await expect(
      assertNoPendingAttachments({} as Page),
    ).resolves.toBeUndefined();
  } finally {
    await browser.close();
  }
});

it("maps fresh numeric filename aliases once and never confirms stale or unrelated cards", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div data-composer-attachments><span class="group/composer-attachment"><span>source(1).ts</span><button aria-label="Remove source(1).ts"></button></span></div><input type="file" multiple><script>
      document.querySelector('input').addEventListener('change', event => {
        event.target.value = '';
        setTimeout(() => {
          for (const name of ['unrelated(2).ts', 'source (2).ts']) {
            const chip = document.createElement('span'); chip.className = 'group/composer-attachment';
            const title = document.createElement('span'); title.textContent = name; chip.append(title);
            const remove = document.createElement('button'); remove.setAttribute('aria-label', 'Remove ' + name); chip.append(remove);
            document.querySelector('[data-composer-attachments]').append(chip);
          }
        }, 100);
      });
    </script>`);
    expect((await uploadAttachments(page, [], [text()])).files).toEqual([
      { name: "source.ts" },
    ]);
    // With no fresh matching alias, even existing cards with the expected alias cannot confirm.
    await page.locator("input").evaluate((element) => {
      const replacement = element.cloneNode() as HTMLInputElement;
      replacement.addEventListener("change", () => {
        replacement.value = "";
      });
      element.replaceWith(replacement);
    });
    const now = vi.spyOn(Date, "now");
    let ticks = 0;
    now.mockImplementation(() => 100_000 + ticks++ * 20_000);
    try {
      await expect(uploadAttachments(page, [], [text()])).rejects.toMatchObject(
        { code: "ATTACHMENT_UPLOAD_FAILED" },
      );
    } finally {
      now.mockRestore();
    }
  } finally {
    await browser.close();
  }
});
