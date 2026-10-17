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
