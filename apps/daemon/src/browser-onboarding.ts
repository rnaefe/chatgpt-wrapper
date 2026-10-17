import type { BrowserContext, Page } from "playwright";
import { ProviderError } from "@chatgpt-wrapper/adapters";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const DEFAULT_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const READINESS_INTERVAL_MS = 1000;
const REQUIRED_STABLE_READINGS = 3;

export interface ReadinessResult {
  ready: boolean;
  error?: {
    code: string;
    message: string;
    status: "NEEDS_AUTH" | "NEEDS_HUMAN" | "BLOCKED_BY_PROVIDER" | "FAILED";
  };
}
/** Return only UI readiness and a bounded error; never page contents or credentials. */
export async function inspectReadiness(
  page: Page,
  source: string,
): Promise<ReadinessResult> {
  if (new URL(page.url()).origin !== CHATGPT_ORIGIN)
    return {
      ready: false,
      error: {
        code: "LOGIN_REDIRECT",
        message:
          "The browser redirected to sign-in. Run chatgpt-wrapper connect to sign in again.",
        status: "NEEDS_AUTH",
      },
    };
  await page.evaluate(source + ";globalThis.WrapperPage=WrapperPage;");
  return page.evaluate(() => {
    const engine = (
      window as unknown as {
        WrapperPage: { pageReadiness: (doc: Document) => ReadinessResult };
      }
    ).WrapperPage;
    const result = engine.pageReadiness(document);
    return {
      ready: result.ready,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            status: result.error.status,
          }
        : undefined,
    };
  });
}
export async function readiness(page: Page, source: string): Promise<boolean> {
  return (await inspectReadiness(page, source)).ready;
}
export async function waitForSignIn(
  context: BrowserContext,
  source: string,
  timeoutMs = DEFAULT_SIGN_IN_TIMEOUT_MS,
): Promise<void> {
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  context.on("close", onClose);
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  try {
    while (Date.now() < deadline) {
      if (closed)
        throw new ProviderError(
          "LOGIN_CANCELLED",
          "Sign-in window closed. Run chatgpt-wrapper connect to try again.",
          "NEEDS_AUTH",
        );
      let ready = false;
      for (const page of context.pages()) {
        try {
          if (await readiness(page, source)) {
            ready = true;
            break;
          }
        } catch {
          /* Navigation during sign-in is expected. */
        }
      }
      consecutive = ready ? consecutive + 1 : 0;
      if (consecutive >= REQUIRED_STABLE_READINGS) return;
      await new Promise((resolve) =>
        setTimeout(resolve, READINESS_INTERVAL_MS),
      );
    }
    throw new ProviderError(
      "LOGIN_TIMEOUT",
      "Sign-in timed out. Run chatgpt-wrapper connect to try again.",
      "NEEDS_AUTH",
    );
  } finally {
    context.off("close", onClose);
  }
}
