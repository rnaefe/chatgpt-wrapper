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
export interface WebRequest {
  capability: string;
  objective: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  timeoutSeconds: number;
  images?: Array<{ source: "path" | "base64" | "url"; name?: string }>;
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
export function markdown(element: Element): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return "";
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (
      ["button", "svg", "script", "style", "nav"].includes(tag) ||
      e.getAttribute("data-markdown-copy") === "exclude" ||
      e.getAttribute("aria-hidden") === "true"
    )
      return "";
    if (tag === "pre") {
      const code = e.querySelector("code");
      const headerNode = e
        .closest("[data-code-block]")
        ?.querySelector('[data-markdown-copy="exclude"]')
        ?.cloneNode(true) as Element | undefined;
      headerNode
        ?.querySelectorAll("button,svg")
        .forEach((node) => node.remove());
      const header = headerNode?.textContent?.trim();
      const language =
        code?.className.match(/language-([\w+-]+)/)?.[1] ??
        header?.match(/^([A-Za-z0-9#+.-]+)/)?.[1].toLowerCase() ??
        "";
      const text = code?.textContent ?? e.textContent ?? "";
      const longest = Math.max(
        2,
        ...Array.from(text.matchAll(/`+/g), (m) => m[0].length),
      );
      const fence = "`".repeat(longest + 1);
      return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
    }
    if (tag === "table") {
      const rows = Array.from(e.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th,td")).map((cell) =>
          Array.from(cell.childNodes)
            .map(walk)
            .join("")
            .trim()
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " "),
        ),
      );
      if (!rows.length) return "";
      const lines = rows.map((row) => `| ${row.join(" | ")} |`);
      lines.splice(1, 0, `| ${rows[0].map(() => "---").join(" | ")} |`);
      return "\n\n" + lines.join("\n") + "\n\n";
    }
    const text = Array.from(e.childNodes).map(walk).join("");
    if (tag === "br") return "\n";
    if (tag === "code") return "`" + text + "`";
    if (tag === "strong" || tag === "b") return "**" + text + "**";
    if (tag === "em" || tag === "i") return "*" + text + "*";
    if (/^h[1-6]$/.test(tag))
      return "\n\n" + "#".repeat(Number(tag[1])) + " " + text + "\n\n";
    if (tag === "li")
      return (
        "\n" +
        (e.parentElement?.tagName === "OL"
          ? `${Array.from(e.parentElement.children).indexOf(e) + 1}. `
          : "- ") +
        text.trim()
      );
    if (tag === "ul" || tag === "ol") return "\n" + text + "\n\n";
    if (tag === "a") {
      const href = e.getAttribute("href");
      if (href && /^https?:\/\//.test(href)) return `[${text}](${href})`;
    }
    if (tag === "p" || tag === "blockquote") return "\n\n" + text + "\n\n";
    return text;
  };
  return walk(element)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function promptFor(request: WebRequest): string {
  return [
    `Task: ${request.capability}`,
    request.objective,
    request.acceptanceCriteria.length
      ? "Acceptance criteria:\n" +
        request.acceptanceCriteria.map((c) => "- " + c).join("\n")
      : "",
    request.allowedPaths.length
      ? "Allowed output paths: " + request.allowedPaths.join(", ")
      : "",
    request.capability.startsWith("code.")
      ? "Preserve code in fenced code blocks with language labels. Provide complete proposed code or unified diffs where appropriate. Do not claim you changed local files."
      : "",
    request.capability === "image.generate"
      ? "Generate an image matching the objective. Do not only describe an image; create the image in the ChatGPT UI."
      : "",
    request.images?.length
      ? "The attached images are part of the task. Inspect them before answering."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
  const primary = Array.from(
    doc.querySelectorAll(`[data-message-author-role="${role}"]`),
  );
  if (primary.length) return primary;
  const current = Array.from(
    doc.querySelectorAll(`[data-chatgpt-search-unit-key$=":${role}"]`),
  );
  return current.length
    ? current
    : Array.from(
        doc.querySelectorAll(
          `[data-turn-role="${role}"], [data-turn="${role}"], [data-message-role="${role}"]`,
        ),
      );
}
function echoesPrompt(node: Element, prompt: string): boolean {
  const body =
    node.querySelector('[data-testid="user-message"], .whitespace-pre-wrap') ??
    node;
  const text = (body as HTMLElement).innerText ?? markdown(body);
  return normalize(text).includes(normalize(prompt));
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
  options: { pollMs?: number; stableMs?: number; readyTimeoutMs?: number } = {},
): Promise<{
  text: string;
  model: string;
  images: Array<{ src: string; mime?: string }>;
}> {
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
  const draftText =
    composer instanceof doc.defaultView!.HTMLTextAreaElement
      ? composer.value
      : (composer.textContent ?? "");
  if (draftText.trim() && isWrapperDraft(draftText)) clearDraft(composer, doc);
  else if (draftText.trim())
    throw new PageError(
      "UNSENT_DRAFT",
      "The Wrapper tab contains an unsent draft. Clear or send it before reconnecting.",
      "NEEDS_HUMAN",
    );
  const oldUsers = new Set(messageNodes(doc, "user"));
  const oldAssistants = new Set(messageNodes(doc, "assistant"));
  const prompt = promptFor(request);
  composer.focus();
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
  const deadline = Date.now() + request.timeoutSeconds * 1000;
  try {
    while (Date.now() < deadline) {
      if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
      const problem = pageProblem(doc);
      if (problem) throw problem;
      if (!user) {
        user = messageNodes(doc, "user").find(
          (n) => !oldUsers.has(n) && echoesPrompt(n, prompt),
        );
        if (user) sawUserAt = Date.now();
        else if (Date.now() > sendDeadline + USER_TURN_CONFIRMATION_GRACE_MS)
          throw new PageError(
            "SUBMISSION_UNCONFIRMED",
            `Could not confirm the submitted prompt (user turns: ${messageNodes(doc, "user").length}, assistant turns: ${messageNodes(doc, "assistant").length}). It will not be sent again automatically.`,
            "NEEDS_HUMAN",
          );
      }
      if (user) {
        const responses = messageNodes(doc, "assistant").filter(
          (n) =>
            !oldAssistants.has(n) && !!(user!.compareDocumentPosition(n) & 4),
        );
        const imageResponses =
          request.capability === "image.generate"
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
        const generatedImage =
          request.capability === "image.generate"
            ? Array.from(doc.querySelectorAll("img")).find(
                (image) =>
                  visible(image) &&
                  !image.closest("nav, [role='navigation']") &&
                  !!(user!.compareDocumentPosition(image) & 4),
              )
            : undefined;
        const response = (responses.at(-1) ??
          imageResponses.at(-1) ??
          generatedImage?.parentElement) as
          | Element
          | undefined;
        if (response) {
          const text = markdown(
            response.querySelector(
              '[data-markdown-text-style="assistant-message"], .markdown, .prose',
            ) ?? response,
          );
          if (text !== previous) {
            previous = text;
            stableAt = Date.now();
          }
          const turn =
            response.closest(
              '[data-talvt-turn-state], article, [data-testid^="conversation-turn"]',
            ) ??
            response.parentElement ??
            response;
          const turnState = turn.getAttribute("data-talvt-turn-state");
          const images = Array.from(
            response.querySelectorAll("img"),
            (image) => ({
              src: image.currentSrc || image.src,
              mime: image.getAttribute("type") ?? undefined,
            }),
          ).filter((image) => image.src);
          const hasGeneratedImage = images.length > 0;
          const complete =
            (!turnState || turnState === "complete") &&
            firstVisible(doc, stopSelector) === null &&
            !turn.querySelector(
              '[data-is-streaming="true"], [aria-busy="true"]',
            ) &&
            Array.from(
              turn.querySelectorAll(
                '[data-testid="copy-turn-action-button"], [data-testid="copy-turn-action"], button[aria-label="Copy"], button[aria-label="Copy response"], button[aria-label="Copy message"]',
              ),
            ).some(
              (button) =>
                visible(button) &&
                !!(response.compareDocumentPosition(button) & 4),
            ) || (request.capability === "image.generate" && hasGeneratedImage);
          if (
            (text || hasGeneratedImage) &&
            complete &&
            Date.now() - stableAt >= stableMs &&
            Date.now() - sawUserAt >= stableMs
          ) {
            const model =
              firstVisible(
                doc,
                '[data-testid="model-switcher-dropdown-button"], [data-testid="model-switcher"], [aria-label="Select ChatGPT model"]',
              )
                ?.textContent?.trim()
                .slice(0, 150) || "ChatGPT · browser selection";
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
