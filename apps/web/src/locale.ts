import en from "./locales/en.json";
import ja from "./locales/ja.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";

export const languages = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
} as const;
export type Locale = keyof typeof languages;
export const localeStorageKey = "2space:locale";
export const localeEvent = "2space:languagechange";
const catalogs: Record<Exclude<Locale, "zh-CN">, Record<string, string>> = {
  en,
  ja,
  fr,
  de,
};

export function browserLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const tag = preference.toLowerCase();
    const primary = tag.split("-")[0];
    if (primary === "zh" && !/(?:^|-)(?:hant|tw|hk|mo)(?:-|$)/.test(tag))
      return "zh-CN";
    if (primary && Object.hasOwn(catalogs, primary))
      return primary as Exclude<Locale, "zh-CN">;
  }
  return "zh-CN";
}

export function localePreference(): Locale | null {
  try {
    const value = localStorage.getItem(localeStorageKey);
    if (value && Object.hasOwn(languages, value)) return value as Locale;
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
  return null;
}

let preference = localePreference();

export function getLocaleSelection() {
  return preference;
}

export function currentLocale(): Locale {
  return (
    preference ??
    browserLocale(
      typeof window === "undefined" ? [] : window.navigator.languages,
    )
  );
}

export function selectLocale(value: Locale | null) {
  preference = value;
  try {
    if (value) localStorage.setItem(localeStorageKey, value);
    else localStorage.removeItem(localeStorageKey);
  } catch {
    // Keep the selection for this page even if it cannot be persisted.
  }
  window.dispatchEvent(new Event(localeEvent));
}

export function subscribeLocale(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== localeStorageKey) return;
    preference = localePreference();
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("languagechange", listener);
  window.addEventListener(localeEvent, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("languagechange", listener);
    window.removeEventListener(localeEvent, listener);
  };
}

export function translate(
  locale: Locale,
  message: string,
  ...values: (string | number)[]
) {
  const catalog = locale === "zh-CN" ? undefined : catalogs[locale];
  const text =
    catalog && Object.hasOwn(catalog, message) ? catalog[message] : message;
  return text.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

export function t(message: string, ...values: (string | number)[]) {
  return translate(currentLocale(), message, ...values);
}

export function updatePageLanguage(title: string) {
  document.documentElement.lang = currentLocale();
  document.title = t(title);
  const description = t("一段文字、一份代码，随手放下，换台设备接着用。");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", description);
}

export function createLanguageSelect(): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "language-select";
  const auto = new Option(t("跟随浏览器"), "");
  select.add(auto);
  for (const [locale, label] of Object.entries(languages)) {
    const option = new Option(label, locale);
    option.lang = locale;
    select.add(option);
  }
  const sync = () => {
    select.setAttribute("aria-label", t("界面语言"));
    auto.text = t("跟随浏览器");
    select.value = preference ?? "";
  };
  sync();
  subscribeLocale(sync);
  select.addEventListener("change", () =>
    selectLocale((select.value || null) as Locale | null),
  );
  return select;
}
