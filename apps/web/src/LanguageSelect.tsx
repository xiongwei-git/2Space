import { useSyncExternalStore } from "react";
import {
  currentLocale,
  getLocaleSelection,
  languages,
  selectLocale,
  subscribeLocale,
  t,
  type Locale,
} from "./locale.js";

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, currentLocale, currentLocale);
}

export default function LanguageSelect() {
  useLocale();
  const value = useSyncExternalStore(subscribeLocale, getLocaleSelection);
  return (
    <select
      className="language-select"
      aria-label={t("界面语言")}
      value={value ?? ""}
      onChange={(event) =>
        selectLocale((event.target.value || null) as Locale | null)
      }
    >
      <option value="">{t("跟随浏览器")}</option>
      {Object.entries(languages).map(([locale, label]) => (
        <option key={locale} lang={locale} value={locale}>
          {label}
        </option>
      ))}
    </select>
  );
}
