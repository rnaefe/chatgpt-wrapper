import { promptFor, type WebRequest } from "./task-prompts.js";
export { promptFor, type WebRequest } from "./task-prompts.js";
import { markdown } from "./page-markdown.js";
import type { ProgressStage } from "@chatgpt-wrapper/contracts";
export { markdown } from "./page-markdown.js";

export type BrowserErrorState =
  "FAILED" | "NEEDS_AUTH" | "NEEDS_HUMAN" | "BLOCKED_BY_PROVIDER";
export class PageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: BrowserErrorState = "FAILED",
  ) {
    super(message);
  }
}
const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_STABLE_INTERVAL_MS = 1800;
const COMPOSER_TIMEOUT_MS = 45_000;
const SEND_CONTROL_TIMEOUT_MS = 10_000;
const USER_TURN_CONFIRMATION_GRACE_MS = 20_000;

const composerSelector =
  '[contenteditable="true"][data-composer-markdown], #prompt-textarea, textarea[data-testid="prompt-textarea"], .ProseMirror[contenteditable="true"][role="textbox"][aria-multiline="true"]';
const stopSelector =
  'button[data-testid="stop-button"], button[data-testid="composer-stop-button"], button[aria-label="Stop"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]';
const sendSelector =
  'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="composer-send-button"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]';
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
function visible(node: Element | null): node is HTMLElement {
  if (!node) return false;
  for (
    let current: Element | null = node;
    current;
    current = current.parentElement
  ) {
    if (
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden") === "true"
    )
      return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden")
      return false;
  }
  return true;
}
function firstVisible(
  doc: Document | Element,
  selector: string,
): HTMLElement | null {
  return (
    (Array.from(doc.querySelectorAll(selector)).find(visible) as HTMLElement) ??
    null
  );
}
export function pageProblem(doc: Document): PageError | undefined {
  if (
    firstVisible(
      doc,
      "#challenge-running, #cf-challenge-running, #challenge-form",
    ) ||
    /just a moment|verify you are human/i.test(doc.title)
  )
    return new PageError(
      "BROWSER_CHALLENGE",
      /just a moment|verify you are human/i.test(doc.title)
        ? "ChatGPT returned a browser-verification document (detected from its page title)."
        : "ChatGPT returned a browser-verification form (challenge-running or challenge-form).",
      "NEEDS_HUMAN",
    );
  if (
    firstVisible(
      doc,
      '[data-testid="login-button"], a[href*="/auth/login"], button[data-testid="login-button"]',
    ) ||
    Array.from(doc.querySelectorAll("button")).some(
      (button) =>
        visible(button) &&
        !button.closest(
          "[data-chatgpt-search-unit-key], [data-message-author-role]",
        ) &&
        /^(log in|sign in)$/i.test(button.textContent?.trim() ?? ""),
    )
  )
    return new PageError(
      "LOGIN_REQUIRED",
      "Run pnpm connect to sign in to ChatGPT again.",
      "NEEDS_AUTH",
    );
  const alerts = Array.from(
    doc.querySelectorAll(
      '[role="alert"], [data-testid="error-message"], .text-token-text-error',
    ),
  )
    .filter((n) => !n.closest("[data-message-author-role]"))
    .map((n) => n.textContent ?? "")
    .join(" ");
  if (
    /usage limit|message limit|reached.*limit|too many requests|rate limit|try again (?:after|at|in)|account.*(?:suspend|deactivat|block)/i.test(
      alerts,
    )
  )
    return new PageError(
      "PROVIDER_LIMIT",
      "ChatGPT reports an account or usage limit. Wait or review access before submitting another task.",
      "BLOCKED_BY_PROVIDER",
    );
  if (
    /something went wrong|unable to (?:load|generate)|network error|error generating/i.test(
      alerts,
    )
  )
    return new PageError(
      "CHATGPT_UI_ERROR",
      "ChatGPT reported an error. Review the Wrapper tab before submitting again.",
      "NEEDS_HUMAN",
    );
}
export function pageReadiness(doc: Document): {
  ready: boolean;
  error?: PageError;
} {
  const problem = pageProblem(doc);
  if (problem) return { ready: false, error: problem };
  return { ready: !!firstVisible(doc, composerSelector) };
}
function producesImage(capability: string): boolean {
  return capability === "image.generate" || capability === "image.edit";
}
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
function messageNodes(doc: Document, role: "user" | "assistant"): Element[] {
  // Provider layouts can coexist while old turns hydrate or a new tool turn mounts.
  // Union their markers, counting a nested representation of one turn only once.
  const selector = `[data-message-author-role="${role}"], [data-chatgpt-search-unit-key$=":${role}"], [data-turn-role="${role}"], [data-turn="${role}"], [data-message-role="${role}"]`;
  return Array.from(doc.querySelectorAll(selector)).filter(
    (node) => !node.parentElement?.closest(selector),
  );
}
function messageIdentity(node: Element): string | undefined {
  const identityNode = node.closest(
    "[data-message-id], [data-turn-id], [data-chatgpt-search-unit-key]",
  );
  if (!identityNode) return undefined;
  for (const attribute of [
    "data-message-id",
    "data-turn-id",
    "data-chatgpt-search-unit-key",
  ]) {
    const value = identityNode.getAttribute(attribute)?.trim();
    if (value) return `${attribute}:${value}`;
  }
}
function messageIdentities(nodes: Set<Element>): Set<string> {
  return new Set(
    Array.from(nodes, messageIdentity).filter(
      (id): id is string => id !== undefined,
    ),
  );
}

function echoesPrompt(node: Element, prompt: string): boolean {
  const expected = normalize(prompt);
  // Inline tool tokens can split the prompt across multiple pre-wrap descendants.
  // The complete user turn must echo the full envelope, never just its prefix.
  const bodies = [
    ...Array.from(
      node.querySelectorAll(
        '[data-testid="user-message"], .whitespace-pre-wrap',
      ),
    ),
    node,
  ];
  return bodies.some((body) =>
    normalize((body as HTMLElement).innerText ?? markdown(body)).includes(
      expected,
    ),
  );
}

function isWrapperDraft(text: string): boolean {
  return (
    normalize(text).startsWith("Task:") &&
    normalize(text).includes("The attached images are part of the task.")
  );
}

function clearDraft(composer: HTMLElement, doc: Document) {
  if (composer instanceof doc.defaultView!.HTMLTextAreaElement) {
    composer.value = "";
  } else {
    composer.replaceChildren();
  }
  composer.dispatchEvent(
    new doc.defaultView!.InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
    }),
  );
}

export function stopGeneration(doc: Document) {
  firstVisible(doc, stopSelector)?.click();
}
export async function executeInPage(
  doc: Document,
  request: WebRequest,
  signal: AbortSignal,
  options: {
    pollMs?: number;
    stableMs?: number;
    readyTimeoutMs?: number;
    onProgress?: (stage: ProgressStage) => void | Promise<void>;
  } = {},
): Promise<{
  text: string;
  model: string;
  images: Array<{ src: string; mime?: string }>;
}> {
  const assertConversation = () => {
    if (
      request.conversationId &&
      doc.location.href !== `https://chatgpt.com/c/${request.conversationId}`
    )
      throw new PageError(
        "CONVERSATION_CHANGED",
        "The browser changed away from the requested conversation. No replacement conversation will be used.",
        "NEEDS_HUMAN",
      );
  };
  assertConversation();
  const pollMs = options.pollMs ?? DEFAULT_POLL_INTERVAL_MS;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_INTERVAL_MS;
  const readyDeadline =
    Date.now() + (options.readyTimeoutMs ?? COMPOSER_TIMEOUT_MS);
  let composer: HTMLElement | null = null;
  while (!composer) {
    const problem = pageProblem(doc);
    if (problem) throw problem;
    composer = firstVisible(doc, composerSelector);
    if (composer) break;
    if (Date.now() > readyDeadline)
      throw new PageError(
        "COMPOSER_NOT_FOUND",
        "The ChatGPT composer was not found. Sign in or check whether the page layout changed.",
        "NEEDS_HUMAN",
      );
    await pause(pollMs, signal);
  }
  if (firstVisible(doc, stopSelector))
    throw new PageError(
      "TAB_BUSY",
      "The Wrapper tab is already generating. Wait for it to finish.",
      "NEEDS_HUMAN",
    );
  const searchPill =
    request.capability === "research.search"
      ? composer.querySelector(
          '[data-inline-selection-pill][data-system-hint-type="search"][contenteditable="false"]',
        )
      : null;
  const draftContent = composer.cloneNode(true) as HTMLElement;
  if (searchPill)
    draftContent
      .querySelectorAll(
        '[data-inline-selection-pill][data-system-hint-type="search"][contenteditable="false"]',
      )
      .forEach((pill) => pill.remove());
  const draftText =
    composer instanceof doc.defaultView!.HTMLTextAreaElement
      ? composer.value
      : (draftContent.textContent ?? "");
  if (draftText.trim() && isWrapperDraft(draftText)) clearDraft(composer, doc);
  else if (draftText.trim())
    throw new PageError(
      "UNSENT_DRAFT",
      "The Wrapper tab contains an unsent draft. Clear or send it before reconnecting.",
      "NEEDS_HUMAN",
    );
  const oldUsers = new Set(messageNodes(doc, "user"));
  const oldAssistants = new Set(messageNodes(doc, "assistant"));
  const oldUserIdentities = messageIdentities(oldUsers);
  const oldAssistantIdentities = messageIdentities(oldAssistants);
  const prompt = promptFor(request);
  composer.focus();
  if (searchPill) {
    const range = doc.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  if (composer instanceof doc.defaultView!.HTMLTextAreaElement) {
    const set = Object.getOwnPropertyDescriptor(
      doc.defaultView!.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    set?.call(composer, prompt);
  } else if (
    typeof doc.execCommand !== "function" ||
    !doc.execCommand("insertText", false, prompt)
  ) {
    if (searchPill)
      throw new PageError(
        "RESEARCH_UNAVAILABLE",
        "The browser could not insert the task while preserving the active Search tool.",
        "NEEDS_HUMAN",
      );
    const paragraphs = prompt.split("\n").map((line) => {
      const p = doc.createElement("p");
      p.textContent = line || "";
      if (!line) p.append(doc.createElement("br"));
      return p;
    });
    composer.replaceChildren(...paragraphs);
  }
  composer.dispatchEvent(
    new doc.defaultView!.InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: prompt,
    }),
  );
  const sendDeadline = Date.now() + SEND_CONTROL_TIMEOUT_MS;
  let send: HTMLElement | null = null;
  while (!send) {
    const problem = pageProblem(doc);
    if (problem) throw problem;
    const form = composer.closest("form");
    const candidate =
      firstVisible(form ?? doc, sendSelector) ??
      (form ? firstVisible(form, 'button[type="submit"]') : null);
    if (
      candidate &&
      !candidate.hasAttribute("disabled") &&
      candidate.getAttribute("aria-disabled") !== "true"
    )
      send = candidate;
    else if (Date.now() > sendDeadline)
      throw new PageError(
        "SEND_BUTTON_NOT_READY",
        "The ChatGPT send control is unavailable. No prompt was sent.",
        "NEEDS_HUMAN",
      );
    else await pause(pollMs, signal);
  }
  if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
  await options.onProgress?.("submitting_prompt");
  if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
  assertConversation();
  const form = composer.closest("form");
  if (
    form &&
    typeof form.requestSubmit === "function" &&
    send.getAttribute("type") === "submit"
  )
    form.requestSubmit(send as HTMLButtonElement);
  else send.click();
  let user: Element | undefined;
  let previous = "";
  let stableAt = Date.now();
  let sawUserAt = 0;
  let receiving = false;
  const deadline = Date.now() + request.timeoutSeconds * 1000;
  try {
    while (Date.now() < deadline) {
      if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
      assertConversation();
      const problem = pageProblem(doc);
      if (problem) throw problem;
      if (!user) {
        user = messageNodes(doc, "user").find((n, index) => {
          if (!echoesPrompt(n, prompt)) return false;
          const identity = messageIdentity(n);
          // Virtualized history can shrink after submission. An unseen stable
          // turn identity establishes freshness without a DOM-count threshold.
          // With no identity, retain the conservative positional check so a
          // rerendered historical copy of this same envelope cannot confirm it.
          return identity !== undefined
            ? !oldUserIdentities.has(identity)
            : !oldUsers.has(n) && index >= oldUsers.size;
        });
        if (user) {
          sawUserAt = Date.now();
          await options.onProgress?.("waiting_response");
        } else if (Date.now() > sendDeadline + USER_TURN_CONFIRMATION_GRACE_MS)
          throw new PageError(
            "SUBMISSION_UNCONFIRMED",
            `Could not confirm the submitted prompt (user turns: ${messageNodes(doc, "user").length}, assistant turns: ${messageNodes(doc, "assistant").length}). It will not be sent again automatically.`,
            "NEEDS_HUMAN",
          );
      }
      if (user) {
        const responses = messageNodes(doc, "assistant").filter((n) => {
          const identity = messageIdentity(n);
          return (
            (identity === undefined
              ? !oldAssistants.has(n)
              : !oldAssistantIdentities.has(identity)) &&
            !!(user!.compareDocumentPosition(n) & 4)
          );
        });
        const imageResponses = producesImage(request.capability)
          ? Array.from(
              doc.querySelectorAll(
                'article, [data-testid^="conversation-turn"], [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], [data-turn-role="assistant"]',
              ),
            ).filter(
              (n) =>
                !!n.querySelector("img") &&
                !!(user!.compareDocumentPosition(n) & 4),
            )
          : [];
        const userTurn =
          user.closest('article, [data-testid^="conversation-turn"]') ?? user;
        const generatedImage = producesImage(request.capability)
          ? Array.from(doc.querySelectorAll("img")).find(
              (image) =>
                visible(image) &&
                !userTurn.contains(image) &&
                !image.closest("nav, [role='navigation']") &&
                !!(user!.compareDocumentPosition(image) & 4),
            )
          : undefined;
        const response = (responses.at(-1) ??
          imageResponses.at(-1) ??
          generatedImage?.parentElement) as Element | undefined;
        if (response) {
          let text = markdown(
            response.querySelector(
              '[data-markdown-text-style="assistant-message"], .markdown, .prose',
            ) ?? response,
          );
          if (request.capability === "research.search") {
            const seen = new Set<string>();
            const links: string[] = [];
            for (const anchor of Array.from(
              response.querySelectorAll("a[href]"),
            )) {
              const href = (anchor as HTMLAnchorElement).href;
              if (
                !/^https?:\/\//i.test(href) ||
                href.length > 2048 ||
                seen.has(href)
              )
                continue;
              try {
                const url = new URL(href);
                if (url.username || url.password) continue;
                seen.add(href);
                const title =
                  (
                    anchor.getAttribute("aria-label") ||
                    anchor.textContent ||
                    url.hostname
                  )
                    .replace(/[\[\]\r\n\x00-\x1f]/g, " ")
                    .trim()
                    .slice(0, 500) || url.hostname;
                if (!text.includes(href)) links.push(`- [${title}](<${href}>)`);
                if (seen.size >= 50) break;
              } catch {
                /* Invalid provider links are omitted. */
              }
            }
            if (links.length) text += "\n\nSources:\n" + links.join("\n");
          }
          const turn =
            response.closest(
              '[data-talvt-turn-state], article, [data-testid^="conversation-turn"]',
            ) ??
            response.parentElement ??
            response;
          const turnState = turn.getAttribute("data-talvt-turn-state");
          const images =
            request.capability === "research.search"
              ? []
              : Array.from(response.querySelectorAll("img"), (image) => ({
                  src: image.currentSrc || image.src,
                  mime: image.getAttribute("type") ?? undefined,
                })).filter((image) => image.src);
          const signature = JSON.stringify([
            text,
            images.map((image) => image.src),
          ]);
          if (signature !== previous) {
            previous = signature;
            stableAt = Date.now();
          }
          const hasGeneratedImage = images.length > 0;
          if (!receiving && (text || hasGeneratedImage)) {
            receiving = true;
            await options.onProgress?.("receiving_response");
          }
          const idle =
            (!turnState || turnState === "complete") &&
            firstVisible(doc, stopSelector) === null &&
            !turn.querySelector(
              '[data-is-streaming="true"], [aria-busy="true"]',
            );
          const hasCopyControl = Array.from(
            turn.querySelectorAll(
              '[data-testid="copy-turn-action-button"], [data-testid="copy-turn-action"], button[aria-label="Copy"], button[aria-label="Copy response"], button[aria-label="Copy message"]',
            ),
          ).some(
            (button) =>
              visible(button) &&
              !!(response.compareDocumentPosition(button) & 4),
          );
          const complete =
            idle &&
            (hasCopyControl ||
              (producesImage(request.capability) && hasGeneratedImage));
          if (
            (text || hasGeneratedImage) &&
            complete &&
            Date.now() - stableAt >= stableMs &&
            Date.now() - sawUserAt >= stableMs
          ) {
            const selectorLabel = firstVisible(
              doc,
              '[data-testid="model-switcher-dropdown-button"], [data-testid="model-switcher"], [aria-label="Select ChatGPT model"]',
            )
              ?.textContent?.trim()
              .slice(0, 150);
            const model =
              !selectorLabel || /^thinking effort/i.test(selectorLabel)
                ? "ChatGPT · browser selection"
                : selectorLabel;
            return { text, model, images };
          }
        }
      }
      await pause(pollMs, signal);
    }
    throw new PageError(
      "COMPLETION_UNCONFIRMED",
      "Could not verify a completed ChatGPT response before the deadline. Partial output was not returned.",
      "NEEDS_HUMAN",
    );
  } catch (error) {
    if (signal.aborted) stopGeneration(doc);
    throw error;
  }
}
