import { t } from "./locale.js";
export const BRAND_SLOGAN = "这边复制，那边就有。";

/** The original two spaces: 17×26, 4 apart, second 7 lower, rotated −8°. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-symbol ${className}`.trim()}
      data-brand-mark="2space-dual"
      viewBox="0 0 39 33"
      width="39"
      height="33"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-8 19.5 16.5)" stroke="#3159DB" strokeWidth="2">
        <rect
          data-brand-panel="first"
          x="1"
          y="1"
          width="15"
          height="24"
          rx="3"
          fill="#EAF0FF"
        />
        <rect
          data-brand-panel="second"
          x="22"
          y="8"
          width="15"
          height="24"
          rx="3"
          fill="#3159DB"
        />
      </g>
    </svg>
  );
}
export function Brand({
  className = "logo",
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <a
      className={`${className} brand`.trim()}
      href={href}
      aria-label={t("2Space 首页")}
    >
      <BrandMark />
      <span className="brand-wordmark">2Space</span>
    </a>
  );
}
