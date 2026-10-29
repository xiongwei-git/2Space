import createDOMPurify from "dompurify";
import type { PlainDocument } from "@2space/shared";
export const SAFE_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "hr",
];
const blockTags = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TR",
]);
function plainText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  const element = node as Element;
  if (element.tagName === "BR") return "\n";
  const text = Array.from(node.childNodes, plainText).join("");
  return text + (blockTags.has(element.tagName) ? "\n" : "");
}
export function createSanitizer(
  windowObject: Parameters<typeof createDOMPurify>[0],
) {
  const purifier = createDOMPurify(windowObject),
    document = (windowObject as unknown as { document: Document }).document;
  return (html: string): string => {
    // Allow structural table tags only long enough to flatten rows without losing cells.
    const safe = purifier.sanitize(html, {
      ALLOWED_TAGS: [
        ...SAFE_TAGS,
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "caption",
      ],
      ALLOWED_ATTR: ["href", "colspan", "rowspan", "class"],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: [
        "img",
        "svg",
        "math",
        "script",
        "style",
        "iframe",
        "video",
        "audio",
        "object",
        "form",
        "input",
      ],
      FORBID_ATTR: ["style", "src", "srcset"],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/[^/]|#)/i,
    });
    const template = document.createElement("template");
    template.innerHTML = safe;
    for (const table of Array.from(
      template.content.querySelectorAll("table"),
    ).reverse()) {
      const replacement = document.createDocumentFragment();
      const caption = table.querySelector("caption");
      if (caption) {
        const p = document.createElement("p");
        p.textContent = plainText(caption).trim();
        replacement.append(p);
      }
      const rows = Array.from(table.querySelectorAll("tr")).filter(
        (row) => row.closest("table") === table,
      );
      for (const row of rows) {
        const cells = Array.from(row.children).filter(
          (cell) => cell.tagName === "TD" || cell.tagName === "TH",
        );
        const p = document.createElement("p");
        p.textContent = cells
          .map((cell) =>
            plainText(cell).replace(/\n+$/g, "").replace(/\n/g, " / "),
          )
          .join(" | ");
        replacement.append(p);
      }
      if (!rows.length && !caption) {
        const p = document.createElement("p");
        p.textContent = plainText(table).trim();
        replacement.append(p);
      }
      table.replaceWith(replacement);
    }
    return template.innerHTML.replace(/ class="[^"]*"/g, (match) =>
      /^language-[\w+-]+$/.test(match.slice(8, -1)) ? match : "",
    );
  };
}
export const sanitizeHtml = (html: string): string =>
  createSanitizer(window)(html);
/** Display-only compatibility: old table cells become rows of plain text; never auto-save. */
export function normalizeDocument(doc: PlainDocument): PlainDocument {
  const hadTable = /<table(?:\s|>)/i.test(doc.html),
    html = sanitizeHtml(doc.html);
  if (!hadTable) return { ...doc, html };
  const template = window.document.createElement("template");
  template.innerHTML = html;
  return {
    ...doc,
    html,
    text: plainText(template.content).replace(/\n$/u, ""),
  };
}
