import createDOMPurify from "dompurify";
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
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];
export function createSanitizer(
  windowObject: Parameters<typeof createDOMPurify>[0],
) {
  const purifier = createDOMPurify(windowObject);
  return (html: string): string =>
    purifier
      .sanitize(html, {
        ALLOWED_TAGS: SAFE_TAGS,
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
      })
      .replace(/ class="[^"]*"/g, (match) => {
        const value = match.slice(8, -1);
        return /^language-[\w+-]+$/.test(value) ? match : "";
      });
}
export const sanitizeHtml = (html: string): string =>
  createSanitizer(window)(html);
