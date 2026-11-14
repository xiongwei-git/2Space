import type { PlainDocument, PageRecord } from "@2space/shared";
export interface LocalPage {
  record: PageRecord;
  doc: PlainDocument;
}
export const RETENTION_LABELS = [
  "永久保留",
  "30分钟",
  "1小时",
  "6小时",
  "1天",
  "3天",
  "1周",
  "1个月",
  "3个月",
  "6个月",
  "1年",
  "2年",
  "3年",
];
export function pageLabel(page: LocalPage, index: number): string {
  if (page.doc.title.trim()) return page.doc.title.trim();
  const chars = Array.from(page.doc.text.replace(/\s+/g, " ").trim());
  return chars.length
    ? chars.slice(0, 6).join("") + (chars.length > 6 ? "…" : "")
    : index === 0
      ? "剪贴板"
      : `记事本${index}`;
}
export function randomExperienceName(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < 4) {
    for (const byte of crypto.getRandomValues(new Uint8Array(8)))
      if (byte < 252 && result.length < 4) result += alphabet[byte % 36];
  }
  return result;
}
export function dateText(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
