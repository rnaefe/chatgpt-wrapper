import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import {
  executeInPage,
  markdown,
  pageProblem,
  pageReadiness,
  promptFor,
  type WebRequest,
} from "../src/page-engine";

const cleaners: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const clean of cleaners.splice(0).reverse()) await clean();
});
const request = () =>
  taskRequestSchema.parse({
    capability: "code.generate",
    objective: "Write a sum function in TypeScript",
    acceptanceCriteria: ["Use explicit types"],
  });
const short = { pollMs: 5, stableMs: 25, readyTimeoutMs: 50 };
function page(
  html = '<main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button></main>',
) {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/" });
  cleaners.push(() => dom.window.close());
  return dom.window.document;
}
function addTurn(doc: Document, role: string, html: string) {
  const article = doc.createElement("article");
  const content = doc.createElement("div");
  content.setAttribute("data-message-author-role", role);
  content.innerHTML = html;
  article.append(content);
  doc.querySelector("main")!.append(article);
  return { article, content };
}
function accept(doc: Document, req = request()) {
  addTurn(doc, "user", "").content.textContent = promptFor(req);
  doc.getElementById("prompt-textarea")!.replaceChildren();
}

describe("ChatGPT page engine (DOM fixtures)", () => {
  it("submits exactly once and preserves code from a completed response", async () => {
    const doc = page();
    let clicks = 0;
    doc.querySelector("button")!.addEventListener("click", () => {
      clicks++;
      accept(doc);
      const turn = addTurn(
        doc,
        "assistant",
        '<div class="markdown"><p>Here is the function.</p><pre><code class="language-typescript">export const sum = (a: number, b: number): number =&gt; a + b;</code></pre></div>',
      );
      const copy = doc.createElement("button");
      copy.dataset.testid = "copy-turn-action-button";
      copy.textContent = "Copy";
      turn.article.append(copy);
    });
    const result = await executeInPage(
      doc,
      request(),
      new AbortController().signal,
      short,
    );
    expect(clicks).toBe(1);
    expect(result.text).toContain("```typescript\nexport const sum");
    expect(result.text).not.toContain("Copy");
    expect(result.text).toContain("Here is the function.");
  });
  it("returns generated image sources from a completed response", async () => {
    const doc = page();
    doc.querySelector("button")!.addEventListener("click", () => {
      accept(doc);
      const response = addTurn(
        doc,
        "assistant",
        '<p>Generated image</p><img src="https://cdn.example/image.png" type="image/png">',
      );
      const copy = doc.createElement("button");
      copy.dataset.testid = "copy-turn-action-button";
      response.article.append(copy);
    });

    const result = await executeInPage(
      doc,
      request(),
      new AbortController().signal,
      short,
    );

    expect(result.images).toEqual([
      { src: "https://cdn.example/image.png", mime: "image/png" },
    ]);
  });
  it.each(["image.generate", "image.edit"])(
    "completes %s when the response has no text or copy control",
    async (capability) => {
      const doc = page();
      const imageRequest = taskRequestSchema.parse({
        capability,
        images:
          capability === "image.edit"
            ? [
                {
                  source: "base64",
                  data: "AP8=",
                  mime: "image/png",
                  name: "reference.png",
                },
              ]
            : [],
        objective: "Create a cabin illustration",
      });
      doc.querySelector("button")!.addEventListener("click", () => {
        accept(doc, imageRequest);
        addTurn(
          doc,
          "assistant",
          '<div><img src="https://cdn.example/generated.png" type="image/png"></div>',
        );
      });

      const result = await executeInPage(
        doc,
        imageRequest,
        new AbortController().signal,
        short,
      );

      expect(result.text).toBe("");
      expect(result.images).toEqual([
        { src: "https://cdn.example/generated.png", mime: "image/png" },
      ]);
    },
  );
  it("does not mistake an uploaded reference for an edited output", async () => {
    const doc = page();
    const edit = taskRequestSchema.parse({
      capability: "image.edit",
      objective: "Make the sky blue",
      images: [
        {
          source: "base64",
          data: "AP8=",
          mime: "image/png",
          name: "reference.png",
        },
      ],
    });
    doc.querySelector("button")!.addEventListener("click", () => {
      accept(doc, edit);
      const reference = doc.createElement("img");
      reference.src = "https://cdn.example/reference.png";
      doc.querySelector("article")!.append(reference);
      setTimeout(
        () =>
          addTurn(
            doc,
            "assistant",
            '<img src="https://cdn.example/edited.png">',
          ),
        90,
      );
    });
    const result = await executeInPage(
      doc,
      edit,
      new AbortController().signal,
      short,
    );
    expect(result.images).toEqual([
      { src: "https://cdn.example/edited.png", mime: undefined },
    ]);
  });
  it("waits for streaming to stop before returning a generated image", async () => {
    const doc = page();
    const imageRequest = taskRequestSchema.parse({
      capability: "image.generate",
      objective: "Create a lake",
    });
    doc.querySelector("button")!.addEventListener("click", () => {
      accept(doc, imageRequest);
      const turn = addTurn(
        doc,
        "assistant",
        '<img src="https://cdn.example/preview.png">',
      );
      const stop = doc.createElement("button");
      stop.dataset.testid = "stop-button";
      doc.body.append(stop);
      setTimeout(() => {
        turn.content.querySelector("img")!.src =
          "https://cdn.example/final.png";
        stop.remove();
      }, 90);
    });
    const result = await executeInPage(
      doc,
      imageRequest,
      new AbortController().signal,
      short,
    );
    expect(result.images[0].src).toBe("https://cdn.example/final.png");
  });
  it("finds an image rendered outside the assistant turn wrapper", async () => {
    const doc = page();
    const imageRequest = taskRequestSchema.parse({
      capability: "image.generate",
      objective: "Create a lake illustration",
    });
    doc.querySelector("button")!.addEventListener("click", () => {
      accept(doc, imageRequest);
      const image = doc.createElement("img");
      image.src = "https://cdn.example/outside-turn.png";
      doc.querySelector("main")!.append(image);
    });

    const result = await executeInPage(
      doc,
      imageRequest,
      new AbortController().signal,
      short,
    );

    expect(result.images).toEqual([
      { src: "https://cdn.example/outside-turn.png", mime: undefined },
    ]);
  });
  it("supports the current idless ProseMirror composer and waits for readiness", async () => {
    const doc = page(
      '<main><form><div contenteditable="true" data-composer-markdown role="textbox" aria-multiline="true" class="ProseMirror" aria-label="Ask ChatGPT"><p><br></p></div><button data-testid="composer-send-button">Send</button></form></main>',
    );
    doc
      .querySelector("form")!
      .addEventListener("submit", (event) => event.preventDefault());
    expect(pageReadiness(doc)).toEqual({ ready: true });
    expect(pageReadiness(page("<main>Loading</main>")).ready).toBe(false);
    doc.querySelector("button")!.addEventListener("click", () => {
      addTurn(doc, "user", "").content.textContent = promptFor(request());
      const response = addTurn(
        doc,
        "assistant",
        "<p>Current composer works</p>",
      );
      const copy = doc.createElement("button");
      copy.dataset.testid = "copy-turn-action-button";
      response.article.append(copy);
    });
    expect(
      (await executeInPage(doc, request(), new AbortController().signal, short))
        .text,
    ).toBe("Current composer works");
  });
  it("confirms paragraph-based user echoes and current turn-role attributes", async () => {
    const doc = page();
    doc.querySelector("button")!.addEventListener("click", () => {
      const user = doc.createElement("article");
      user.dataset.turnRole = "user";
      for (const line of promptFor(request()).split("\n")) {
        const p = doc.createElement("p");
        p.textContent = line;
        user.append(p);
      }
      doc.querySelector("main")!.append(user);
      const answer = doc.createElement("article");
      answer.dataset.turnRole = "assistant";
      answer.innerHTML =
        '<p>Verified reply</p><button aria-label="Copy message">Copy</button>';
      doc.querySelector("main")!.append(answer);
    });
    expect(
      (await executeInPage(doc, request(), new AbortController().signal, short))
        .text,
    ).toBe("Verified reply");
  });
  it("collects the current search-unit layout with its explicit complete marker and code language", async () => {
    const doc = page();
    doc.querySelector("button")!.addEventListener("click", () => {
      const turn = doc.createElement("div");
      turn.dataset.talvtTurnState = "streaming";
      const user = doc.createElement("div");
      user.dataset.chatgptSearchUnitKey = "turn-0:0:user";
      const bubble = doc.createElement("div");
      bubble.className = "whitespace-pre-wrap";
      bubble.textContent = promptFor(request());
      user.append(bubble);
      turn.append(user);
      const assistant = doc.createElement("div");
      assistant.dataset.chatgptSearchUnitKey = "turn-0:2:assistant";
      assistant.innerHTML =
        '<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message"><div data-code-block="true"><div data-markdown-copy="exclude">TypeScript<button>Copy code</button></div><pre><code><span>export const verified = true;</span></code></pre></div></div>';
      turn.append(assistant);
      const copy = doc.createElement("button");
      copy.setAttribute("aria-label", "Copy");
      turn.append(copy);
      doc.querySelector("main")!.append(turn);
      setTimeout(() => (turn.dataset.talvtTurnState = "complete"), 60);
    });
    const result = await executeInPage(
      doc,
      request(),
      new AbortController().signal,
      short,
    );
    expect(result.text).toBe(
      "```typescript\nexport const verified = true;\n```",
    );
  });
  it("never returns old assistant text or stable-but-streaming partial output", async () => {
    const doc = page();
    const old = addTurn(doc, "assistant", "Old response");
    old.article.innerHTML +=
      '<button data-testid="copy-turn-action-button">Copy</button>';
    doc
      .querySelector('button[data-testid="send-button"]')!
      .addEventListener("click", () => {
        accept(doc);
        const turn = addTurn(doc, "assistant", "<p>Partial</p>");
        const stop = doc.createElement("button");
        stop.dataset.testid = "stop-button";
        doc.querySelector("main")!.append(stop);
        setTimeout(() => {
          turn.content.innerHTML = "<p>Final response</p>";
          stop.remove();
          const copy = doc.createElement("button");
          copy.dataset.testid = "copy-turn-action-button";
          turn.article.append(copy);
        }, 70);
      });
    const result = await executeInPage(
      doc,
      request(),
      new AbortController().signal,
      short,
    );
    expect(result.text).toBe("Final response");
  });
  it("does not accept a response without an explicit completion control", async () => {
    const doc = page();
    doc.querySelector("button")!.addEventListener("click", () => {
      accept(doc);
      addTurn(doc, "assistant", "Stable but incomplete");
    });
    const controller = new AbortController();
    const result = executeInPage(doc, request(), controller.signal, short);
    const assertion = expect(result).rejects.toThrow("deadline");
    setTimeout(() => controller.abort(new Error("deadline")), 80);
    await assertion;
  });
  it("stops generation on cancellation without clicking send twice", async () => {
    const doc = page();
    let sends = 0,
      stops = 0;
    doc.querySelector("button")!.addEventListener("click", () => {
      sends++;
      accept(doc);
      const stop = doc.createElement("button");
      stop.dataset.testid = "stop-button";
      stop.addEventListener("click", () => stops++);
      doc.querySelector("main")!.append(stop);
    });
    const controller = new AbortController();
    const result = executeInPage(doc, request(), controller.signal, short);
    const assertion = expect(result).rejects.toThrow("cancelled");
    setTimeout(() => controller.abort(new Error("cancelled")), 30);
    await assertion;
    expect(sends).toBe(1);
    expect(stops).toBe(1);
  });
  it("refuses to overwrite an unsent draft", async () => {
    const doc = page();
    doc.getElementById("prompt-textarea")!.textContent = "My private draft";
    await expect(
      executeInPage(doc, request(), new AbortController().signal, short),
    ).rejects.toMatchObject({ code: "UNSENT_DRAFT" });
  });
  it("detects login, challenges and limit banners without treating answer text as a limit", () => {
    expect(pageProblem(page('<a href="/auth/login">Log in</a>'))?.status).toBe(
      "NEEDS_AUTH",
    );
    expect(
      pageProblem(page('<div id="challenge-running"></div>'))?.status,
    ).toBe("NEEDS_HUMAN");
    expect(
      pageProblem(
        page('<div role="alert">You have reached your message limit</div>'),
      )?.status,
    ).toBe("BLOCKED_BY_PROVIDER");
    expect(
      pageProblem(
        page(
          '<div data-message-author-role="assistant"><div role="alert">too many requests example</div></div>',
        ),
      ),
    ).toBeUndefined();
  });
  it("ignores a passive Cloudflare iframe when the composer is ready", () => {
    const doc = page(
      '<main><iframe src="https://challenges.cloudflare.com/turnstile" style="width:0;height:0;border:0"></iframe><div id="prompt-textarea" contenteditable="true"></div></main>',
    );
    expect(pageProblem(doc)).toBeUndefined();
    expect(pageReadiness(doc).ready).toBe(true);
  });
  it("recognizes a challenge document even without an iframe", () => {
    const doc = page("<main>Checking your browser</main>");
    doc.title = "Just a moment...";
    expect(pageProblem(doc)?.code).toBe("BROWSER_CHALLENGE");
  });
  it("fails selector drift before submitting", async () => {
    await expect(
      executeInPage(
        page("<main>No composer</main>"),
        request(),
        new AbortController().signal,
        short,
      ),
    ).rejects.toMatchObject({ code: "COMPOSER_NOT_FOUND" });
  });
  it("preserves headings, lists, tables and code containing backticks", () => {
    const doc = page(
      '<main><h2>Result</h2><ul><li>First</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><pre><code>const x = "```";</code></pre></main>',
    );
    const result = markdown(doc.querySelector("main")!);
    expect(result).toContain("## Result");
    expect(result).toContain("- First");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain('````\nconst x = "```";\n````');
  });
});
