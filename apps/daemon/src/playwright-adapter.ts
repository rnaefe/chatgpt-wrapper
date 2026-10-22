import {
  capabilitySchema,
  progressStageSchema,
} from "@chatgpt-wrapper/contracts";
import {
  uploadImages,
  downloadImages,
  type GeneratedImage,
} from "./browser-images.js";
export { validateImagePath, validateImageUrl } from "./browser-images.js";
import { inspectReadiness, waitForSignIn } from "./browser-onboarding.js";
import { selectModel } from "./browser-models.js";
import {
  uploadAttachments,
  assertNoPendingAttachments,
} from "./browser-files.js";
import { enableResearch } from "./browser-research.js";
import { openConversation, readConversation } from "./browser-conversations.js";
import type { WebRequest } from "./page-engine.js";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";

import {
  ProviderError,
  type Adapter,
  type AdapterOutput,
  type ProgressReporter,
} from "@chatgpt-wrapper/adapters";
import type { TaskRequest, TaskStatus } from "@chatgpt-wrapper/contracts";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const NAVIGATION_TIMEOUT_MS = 45_000;
const capabilities = [...capabilitySchema.options];

type PageResult =
  | {
      value: {
        text: string;
        model: string;
        images?: GeneratedImage[];
      };
    }
  | { error: { code: string; message: string; status?: string } };

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
/** Browser contexts live only for sign-in or a single task; prompts are never replayed. */
export class PlaywrightAdapter implements Adapter {
  private active = false;
  private onboardingContext?: BrowserContext;
  private taskContext?: BrowserContext;
  async close() {
    await this.onboardingContext?.close().catch(() => {});
    await this.taskContext?.close().catch(() => {});
  }
  private state: TaskStatus | "READY" | "SIGNING_IN" | "VERIFYING" =
    "NEEDS_AUTH";
  private message = "Run chatgpt-wrapper connect to sign in.";

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
    return {
      ...this.info(),
      state: this.state,
      message: this.message,
      mode: this.headless ? "headless" : "visible",
    };
  }
  canStart() {
    return !this.active;
  }

  private engineSource?: Promise<string>;
  private loadEngine() {
    return (this.engineSource ??= readFile(this.enginePath, "utf8").catch(
      (error) => {
        this.engineSource = undefined;
        throw error;
      },
    ));
  }

  private async openPage(context: BrowserContext) {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(CHATGPT_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    return page;
  }

  private async openTaskPage(
    context: BrowserContext,
    request: TaskRequest,
    signal: AbortSignal,
  ) {
    const page =
      typeof context.newPage === "function"
        ? await context.newPage()
        : context.pages()[0];
    if (request.conversationId) {
      await openConversation(page, request.conversationId, signal);
      return page;
    }
    await page.goto(CHATGPT_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await this.startNewConversation(page);
    return page;
  }

  private async startNewConversation(page: Page) {
    if (typeof page.locator !== "function") return;
    const newChats = page.locator(
      [
        'button[aria-label*="new chat" i]',
        'button[data-testid*="new-chat" i]',
        '[role="button"][aria-label*="new chat" i]',
        'button:has-text("New chat")',
        'a:has-text("New chat")',
        '[role="button"]:has-text("New chat")',
      ].join(", "),
    );
    // The page can expose a hidden mobile control before the visible global
    // action, plus project-specific actions that must not capture generic tasks.
    for (const exact of [true, false]) {
      for (let i = 0; i < (await newChats.count()); i++) {
        const newChat = newChats.nth(i);
        const aria = (await newChat.getAttribute("aria-label"))?.trim();
        if (exact && aria?.toLowerCase() !== "new chat") continue;
        if (aria && /^new chat in\b/i.test(aria)) continue;
        if (!(await newChat.isVisible()) || !(await newChat.isEnabled()))
          continue;
        await newChat.click();
        await page.waitForTimeout(250);
        return;
      }
    }
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
        `Sign-in was saved. Headless check: ${problem.message} To try visible execution, set BROWSER_HEADLESS=false, restart the worker, and run chatgpt-wrapper connect.`,
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
      "Sign-in was saved, but the background connection needs attention. Run chatgpt-wrapper connect to review the browser.",
      "NEEDS_HUMAN",
    );
  }

  private async evaluateRequest(
    page: Page,
    source: string,
    request: WebRequest,
    onProgress?: ProgressReporter,
    signal?: AbortSignal,
  ) {
    if (new URL(page.url()).origin !== CHATGPT_ORIGIN)
      throw new ProviderError(
        "LOGIN_REQUIRED",
        "Run chatgpt-wrapper connect to sign in.",
        "NEEDS_AUTH",
      );

    if (onProgress) {
      await page.exposeBinding(
        "__wrapperReportProgress",
        ({ frame }, value: unknown) => {
          if (signal?.aborted || frame !== page.mainFrame()) return;
          const stage = progressStageSchema.safeParse(value);
          if (
            stage.success &&
            [
              "submitting_prompt",
              "waiting_response",
              "receiving_response",
            ].includes(stage.data)
          )
            onProgress(stage.data);
        },
      );
    }
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
                options?: { onProgress?: (stage: string) => Promise<void> },
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
              {
                onProgress: async (stage) => {
                  const report = (
                    window as unknown as {
                      __wrapperReportProgress?: (
                        stage: string,
                      ) => Promise<void>;
                    }
                  ).__wrapperReportProgress;
                  if (report) await report(stage);
                },
              },
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
      context = await openProfile(profileDirectory(this.directory), false);
      this.onboardingContext = context;
      await this.openPage(context);
      await waitForSignIn(context, source);
      if (!this.headless) {
        this.state = "READY";
        this.message =
          "Sign-in saved. The browser will open only while a task runs.";
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
          : "Could not finish connecting. Run chatgpt-wrapper connect to try again.";
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
    onProgress?: ProgressReporter,
  ): Promise<AdapterOutput> {
    if (!capabilities.includes(request.capability))
      throw new ProviderError(
        "UNSUPPORTED_CAPABILITY",
        "The browser adapter does not support this capability.",
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
    let taskPage: Page | undefined;
    // Closing this task's context cancels evaluation and releases its profile.
    const abort = () => {
      void context?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const source = await this.loadEngine();
      onProgress?.("opening_browser");
      context = await openProfile(
        profileDirectory(this.directory),
        this.headless,
      );
      this.taskContext = context;
      if (signal.aborted) throw signal.reason;
      onProgress?.("preparing_chat");
      taskPage = await this.openTaskPage(context, request, signal);
      await assertNoPendingAttachments(taskPage);
      let selectedModel: string | undefined;
      if (request.model) {
        onProgress?.("selecting_model");
        selectedModel = await selectModel(taskPage, request.model, signal);
      }
      if (request.capability === "research.search") {
        onProgress?.("preparing_research");
        await enableResearch(taskPage, signal);
      }
      if (request.files?.length) onProgress?.("uploading_files");
      else if (request.images?.length) onProgress?.("uploading_images");
      const attachments = request.files?.length
        ? await uploadAttachments(
            taskPage,
            request.images,
            request.files,
            signal,
          )
        : {
            images: await uploadImages(taskPage, request.images, signal),
            files: [],
          };
      // Attachment controls may rerender the composer and reset the active tool.
      if (request.capability === "research.search")
        await enableResearch(taskPage, signal);
      const result = await this.evaluateRequest(
        taskPage,
        source,
        {
          ...request,
          images: attachments.images,
          files: attachments.files,
        },
        onProgress,
        signal,
      );
      if (result.images?.length) onProgress?.("downloading_images");
      const outputImages = await downloadImages(taskPage, result.images);
      const conversation = await readConversation(
        taskPage,
        request.conversationId,
        signal,
      );
      this.state = "READY";
      this.message = "ChatGPT connected. Last task completed.";
      return {
        text: result.text,
        model: selectedModel ?? result.model,
        images: outputImages,
        adapter: "chatgpt-playwright",
        ...conversation,
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
      await context?.close().catch(() => {});
      this.taskContext = undefined;
      this.active = false;
    }
  }
}
