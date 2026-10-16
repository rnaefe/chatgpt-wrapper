import { inspectReadiness, waitForSignIn } from "./browser-onboarding.js";
import type { WebRequest } from "./page-engine.js";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  ProviderError,
  type Adapter,
  type AdapterOutput,
} from "@chatgpt-wrapper/adapters";
import type {
  TaskRequest,
  Capability,
  TaskStatus,
} from "@chatgpt-wrapper/contracts";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const NAVIGATION_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const capabilities: Capability[] = [
  "code.generate",
  "code.review",
  "reason.analyze",
  "image.generate",
];

type PageResult =
  | {
      value: {
        text: string;
        model: string;
        images?: GeneratedImage[];
      };
    }
  | { error: { code: string; message: string; status?: string } };

type GeneratedImage = { src: string; mime?: string };

type UploadFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

export function profileDirectory(dataDirectory: string) {
  const profile = join(dataDirectory, "playwright-profile");
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  chmodSync(profile, 0o700);
  return profile;
}
export async function openProfile(
  profile: string,
  headless: boolean,
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profile, {
      headless,
      channel: "chromium",
      acceptDownloads: false,
    });
  } catch {
    throw new ProviderError(
      "BROWSER_START_FAILED",
      "Browser could not start. Install Chromium with pnpm browser:install and close any login window using this profile.",
      "NEEDS_HUMAN",
    );
  }
}
/** Visible mode keeps the signed-in context alive; prompts are never replayed. */
export class PlaywrightAdapter implements Adapter {
  private active = false;
  private onboardingContext?: BrowserContext;
  private visibleContext?: BrowserContext;
  private keepVisible(context: BrowserContext) {
    this.visibleContext = context;
    context.once("close", () => {
      if (this.visibleContext === context) {
        this.visibleContext = undefined;
        this.state = "NEEDS_AUTH";
        this.message = "Browser closed. Run pnpm connect to reopen it.";
      }
    });
  }
  async close() {
    await this.onboardingContext?.close().catch(() => {});
    await this.visibleContext?.close().catch(() => {});
    this.visibleContext = undefined;
  }
  private state: TaskStatus | "READY" | "SIGNING_IN" | "VERIFYING" =
    "NEEDS_AUTH";
  private message = "Run pnpm connect to sign in.";

  constructor(
    private readonly directory: string,
    private readonly enginePath: string,
    private headless = false,
  ) {}
  info() {
    return {
      name: "chatgpt-playwright",
      configured: this.state === "READY" || this.state === "RUNNING",
      model: "ChatGPT · browser selection",
      capabilities,
    };
  }
  status() {
    return { ...this.info(), state: this.state, message: this.message };
  }
  canStart() {
    return !this.active;
  }

  private async loadEngine() {
    return readFile(this.enginePath, "utf8");
  }

  private async openPage(context: BrowserContext) {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(CHATGPT_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    return page;
  }

  private async openTaskPage(context: BrowserContext) {
    const page =
      typeof context.newPage !== "function"
        ? await this.openPage(context)
        : await context.newPage();
    await page.goto(CHATGPT_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await this.startNewConversation(page);
    return page;
  }

  private async startNewConversation(page: Page) {
    if (typeof page.locator !== "function") return;
    const newChat = page
      .locator(
        [
          'button[aria-label*="new chat" i]',
          'button[data-testid*="new-chat" i]',
          '[role="button"][aria-label*="new chat" i]',
          'button:has-text("New chat")',
          'a:has-text("New chat")',
          '[role="button"]:has-text("New chat")',
        ].join(", "),
      )
      .first();
    if (!(await newChat.count()) || !(await newChat.isVisible())) return;
    await newChat.click();
    await page.waitForTimeout(250);
  }

  private async verifyHeadlessConnection(
    context: BrowserContext,
    source: string,
  ) {
    const page = await this.openPage(context);
    let problem: Awaited<ReturnType<typeof inspectReadiness>>["error"];

    for (let attempt = 0; attempt < 30; attempt++) {
      const inspection = await inspectReadiness(page, source);
      problem = inspection.error;
      if (inspection.ready) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (problem?.code === "BROWSER_CHALLENGE")
      throw new ProviderError(
        "HEADLESS_CHALLENGE",
        `Sign-in was saved. Headless check: ${problem.message} To try visible execution, set BROWSER_HEADLESS=false, restart the worker, and run pnpm connect.`,
        "NEEDS_HUMAN",
      );
    if (problem)
      throw new ProviderError(
        problem.code,
        `Sign-in was saved. Headless check: ${problem.message}`,
        problem.status,
      );
    throw new ProviderError(
      "BACKGROUND_NOT_READY",
      "Sign-in was saved, but the background connection needs attention. Run pnpm connect to review the browser.",
      "NEEDS_HUMAN",
    );
  }

  private async evaluateRequest(
    page: Page,
    source: string,
    request: WebRequest,
  ) {
    if (new URL(page.url()).origin !== CHATGPT_ORIGIN)
      throw new ProviderError(
        "LOGIN_REQUIRED",
        "Run pnpm connect to sign in.",
        "NEEDS_AUTH",
      );

    await page.evaluate(source + ";globalThis.WrapperPage=WrapperPage;");
    const result = await page.evaluate<PageResult, WebRequest>(
      async (pageRequest) => {
        const engine = (
          window as unknown as {
            WrapperPage: {
              executeInPage: (
                doc: Document,
                request: unknown,
                signal: AbortSignal,
              ) => Promise<{ text: string; model: string }>;
            };
          }
        ).WrapperPage;
        try {
          return {
            value: await engine.executeInPage(
              document,
              pageRequest,
              new AbortController().signal,
            ),
          };
        } catch (error) {
          const failure = error as Error & { code?: string; status?: string };
          return {
            error: {
              code: failure.code ?? "PAGE_FAILED",
              message: failure.message,
              status: failure.status,
            },
          };
        }
      },
      request,
    );

    if ("error" in result) {
      const status =
        result.error.status === "NEEDS_AUTH" ||
        result.error.status === "NEEDS_HUMAN" ||
        result.error.status === "BLOCKED_BY_PROVIDER"
          ? result.error.status
          : "FAILED";
      throw new ProviderError(result.error.code, result.error.message, status);
    }
    if (!result.value)
      throw new ProviderError(
        "EMPTY_RESULT",
        "The browser returned no completed response.",
        "NEEDS_HUMAN",
      );
    return result.value;
  }

  private async resolveImageInput(
    input: TaskRequest["images"][number],
  ): Promise<UploadFile> {
    if (input.source === "path") {
      const buffer = await readFile(input.path);
      if (buffer.length > MAX_IMAGE_BYTES)
        throw new ProviderError(
          "IMAGE_TOO_LARGE",
          `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit: ${input.path}`,
        );
      return {
        name: input.path.split("/").at(-1) || "image",
        mimeType: imageMime(input.path),
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
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new ProviderError(
        "IMAGE_DOWNLOAD_FAILED",
        `Could not download image (HTTP ${response.status}).`,
      );
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type")?.split(";")[0];
    if (!mimeType?.startsWith("image/"))
      throw new ProviderError(
        "IMAGE_TYPE_UNSUPPORTED",
        "Image URL did not return an image.",
      );
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new ProviderError(
        "IMAGE_TOO_LARGE",
        `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit.`,
      );
    return {
      name: new URL(input.url).pathname.split("/").at(-1) || "image",
      mimeType,
      buffer,
    };
  }

  private async uploadImages(
    page: Page,
    inputs: TaskRequest["images"] | undefined,
  ): Promise<Array<{ source: "path" | "base64" | "url"; name: string }>> {
    if (!inputs?.length) return [];
    const files = await Promise.all(
      inputs.map((input) => this.resolveImageInput(input)),
    );
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
    if (
      (await attachmentButton.count()) &&
      (await attachmentButton.isVisible())
    )
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

  private async downloadImages(page: Page, images: GeneratedImage[] = []) {
    return Promise.all(
      images.map(async (image) => {
        const result = await page.evaluate(async (src) => {
          const response = await fetch(src);
          if (!response.ok)
            throw new Error(`Image download failed: ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 10 * 1024 * 1024)
            throw new Error("Image exceeds 10 MiB");
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return {
            data: btoa(binary),
            mime: response.headers.get("content-type") ?? undefined,
          };
        }, image.src);
        return {
          data: Buffer.from(result.data, "base64"),
          mime: image.mime ?? result.mime ?? "image/png",
          source: "chatgpt-playwright",
        };
      }),
    );
  }

  async connect(): Promise<void> {
    if (this.active)
      throw new ProviderError(
        "BROWSER_BUSY",
        "A task or sign-in is already in progress.",
      );
    this.active = true;
    this.state = "SIGNING_IN";
    this.message =
      "Sign in in the window that opened. We will finish setup automatically.";
    let context: BrowserContext | undefined;
    try {
      const source = await this.loadEngine();
      const existing = this.visibleContext;
      context =
        existing ??
        (await openProfile(profileDirectory(this.directory), false));
      this.onboardingContext = context;
      if (!existing) await this.openPage(context);
      await waitForSignIn(context, source);
      if (!this.headless) {
        if (!existing) this.keepVisible(context);
        this.state = "READY";
        this.message =
          "ChatGPT connected. Keep this browser open; MCP tasks run here.";
        context = undefined;
        return;
      }
      this.state = "VERIFYING";
      this.message = "Signed in. Checking the background connection…";
      await context.close();
      context = undefined;
      context = await openProfile(
        profileDirectory(this.directory),
        this.headless,
      );
      this.onboardingContext = context;
      await this.verifyHeadlessConnection(context, source);
      this.state = "READY";
      this.message =
        "ChatGPT connected. You can use Wrapper from your coding tool.";
    } catch (error) {
      this.state =
        error instanceof ProviderError ? error.status : "NEEDS_HUMAN";
      this.message =
        error instanceof ProviderError
          ? error.message
          : "Could not finish connecting. Run pnpm connect to try again.";
      throw error;
    } finally {
      await context?.close().catch(() => {});
      this.onboardingContext = undefined;
      this.active = false;
    }
  }
  async execute(
    request: TaskRequest,
    signal: AbortSignal,
  ): Promise<AdapterOutput> {
    if (!capabilities.includes(request.capability))
      throw new ProviderError(
        "UNSUPPORTED_CAPABILITY",
        "The headless adapter supports text and code tasks only.",
      );
    if (this.active)
      throw new ProviderError(
        "BROWSER_BUSY",
        "A browser task is already running.",
      );
    if (signal.aborted) throw signal.reason;
    this.active = true;
    this.state = "RUNNING";
    let context: BrowserContext | undefined;
    // Closing the owned context aborts navigation/evaluation and releases the profile lock.
    const abort = () => {
      void context?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const source = await this.loadEngine();
      context =
        this.visibleContext ??
        (await openProfile(profileDirectory(this.directory), this.headless));
      if (!this.headless && !this.visibleContext) this.keepVisible(context);
      if (signal.aborted) throw signal.reason;
      const page = await this.openTaskPage(context);
      const images = await this.uploadImages(page, request.images);
      const result = await this.evaluateRequest(page, source, {
        ...request,
        images,
      });
      const outputImages = await this.downloadImages(page, result.images);
      this.state = "READY";
      this.message = "ChatGPT connected. Last task completed.";
      return {
        text: result.text,
        model: result.model,
        images: outputImages,
        adapter: "chatgpt-playwright",
      };
    } catch (error) {
      this.state =
        error instanceof ProviderError ? error.status : "NEEDS_HUMAN";
      this.message =
        error instanceof ProviderError
          ? error.message
          : "Browser interrupted. No prompt was retried.";
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "BROWSER_INTERRUPTED",
        this.message,
        "NEEDS_HUMAN",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.headless || signal.aborted)
        await context?.close().catch(() => {});
      this.active = false;
    }
  }
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
