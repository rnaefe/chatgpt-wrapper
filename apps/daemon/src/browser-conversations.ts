import type { Page } from "playwright";
import { ProviderError } from "@chatgpt-wrapper/adapters";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const CONVERSATION_URL =
  /^https:\/\/chatgpt\.com\/c\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?![\s\S])/;

export function conversationIdFromUrl(input: string): string | undefined {
  // Match the original string so URL normalization cannot conceal credentials,
  // ports, dot segments, or extra delimiters.
  return CONVERSATION_URL.exec(input)?.[1]?.toLowerCase();
}
function checkedId(id: string): string {
  if (!UUID.test(id))
    throw new ProviderError(
      "INVALID_CONVERSATION_ID",
      "Conversation ID must be a UUID.",
    );
  return id.toLowerCase();
}
const unavailable = () =>
  new ProviderError(
    "CONVERSATION_UNAVAILABLE",
    "The requested conversation did not load with existing history.",
    "NEEDS_HUMAN",
  );
function aborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
async function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  aborted(signal);
  if (!signal) return work;
  let onAbort: () => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Operation aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancellation]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
async function pause(signal?: AbortSignal): Promise<void> {
  aborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, 200);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal?.reason ?? new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
async function historyState(page: Page, signal?: AbortSignal) {
  aborted(signal);
  const url = new URL(page.url());
  if (
    /\/auth(?:\/|$)|\/login(?:\/|$)/i.test(url.pathname) ||
    /(^|\.)auth\.openai\.com$/.test(url.hostname)
  )
    throw new ProviderError(
      "LOGIN_REQUIRED",
      "Sign in to ChatGPT again.",
      "NEEDS_AUTH",
    );
  return abortable(
    page.evaluate(() => {
      const visible = (node: Element) => {
        for (
          let current: Element | null = node;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (
            current.hasAttribute("hidden") ||
            current.getAttribute("aria-hidden") === "true" ||
            style.display === "none" ||
            style.visibility === "hidden"
          )
            return false;
        }
        return node.getClientRects().length > 0;
      };
      const any = (selector: string) =>
        Array.from(document.querySelectorAll(selector)).some(visible);
      const login =
        any('[data-testid="login-button"], a[href*="/auth/login"]') ||
        Array.from(document.querySelectorAll("button")).some(
          (node) =>
            visible(node) &&
            !node.closest(
              "[data-message-author-role], [data-chatgpt-search-unit-key]",
            ) &&
            /^(log in|sign in)$/i.test(node.textContent?.trim() ?? ""),
        );
      const challenge =
        any("#challenge-running, #cf-challenge-running, #challenge-form") ||
        /just a moment|verify you are human/i.test(document.title);
      const history = ["user", "assistant"].some((role) =>
        any(
          `[data-message-author-role="${role}"], [data-chatgpt-search-unit-key$=":${role}"], [data-turn-role="${role}"], [data-turn="${role}"], [data-message-role="${role}"]`,
        ),
      );
      return { login, challenge, history };
    }),
    signal,
  );
}

export async function openConversation(
  page: Page,
  conversationId: string,
  signal: AbortSignal,
): Promise<void> {
  const id = checkedId(conversationId);
  aborted(signal);
  const target = `https://chatgpt.com/c/${id}`;
  try {
    await abortable(
      page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 }),
      signal,
    );
    const deadline = Date.now() + 10_000;
    do {
      aborted(signal);
      const state = await historyState(page, signal);
      if (state.login)
        throw new ProviderError(
          "LOGIN_REQUIRED",
          "Sign in to ChatGPT again.",
          "NEEDS_AUTH",
        );
      if (state.challenge) throw unavailable();
      if (page.url() !== target) throw unavailable();
      if (state.history) return;
      await pause(signal);
    } while (Date.now() < deadline);
  } catch (error) {
    aborted(signal);
    if (error instanceof ProviderError) throw error;
    throw unavailable();
  }
  throw unavailable();
}

export async function readConversation(
  page: Page,
  expectedId?: string,
  signal?: AbortSignal,
): Promise<{ conversationId: string; conversationUrl: string } | undefined> {
  const expected = expectedId === undefined ? undefined : checkedId(expectedId);
  aborted(signal);
  const id = conversationIdFromUrl(page.url());
  if (expected !== undefined && id !== expected)
    throw new ProviderError(
      "CONVERSATION_CHANGED",
      "The browser changed away from the requested conversation.",
      "NEEDS_HUMAN",
    );
  return id
    ? { conversationId: id, conversationUrl: `https://chatgpt.com/c/${id}` }
    : undefined;
}
