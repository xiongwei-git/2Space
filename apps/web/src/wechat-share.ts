import {
  createLanguageSelect,
  subscribeLocale,
  t,
  updatePageLanguage,
} from "./locale.js";
import "./standalone.css";

type ShareData = { title: string; desc: string; link: string; imgUrl: string };
type Wx = {
  config(value: Record<string, unknown>): void;
  ready(callback: () => void): void;
  error(callback: () => void): void;
  updateAppMessageShareData(
    value: ShareData & { success(): void; fail(): void },
  ): void;
  updateTimelineShareData(value: ShareData): void;
};
const pageUrl = "https://2space.cn/wechat-share.html";
const status = document.getElementById("status")!;
let statusMessage = "在微信中打开本页，点右上角「…」，选择「转发给朋友」。";
let refreshWechatCard: (() => void) | undefined;
function render() {
  updatePageLanguage("分享 2Space · 这边复制，那边就有。");
  document.getElementById("slogan")!.textContent = t("这边复制，那边就有。");
  document.getElementById("description")!.textContent = t(
    "一段文字、一份代码，随手放下，换台设备接着用。",
  );
  document.getElementById("open")!.textContent = t("打开 2Space");
  document
    .getElementById("share-cover")!
    .setAttribute("alt", t("2Space 双格标志"));
  status.textContent = t(statusMessage);
}
function setStatus(message: string) {
  statusMessage = message;
  status.textContent = t(message);
}
document.getElementById("language-control")!.append(createLanguageSelect());
subscribeLocale(() => {
  render();
  refreshWechatCard?.();
});
render();

async function setup() {
  // This is a separate document, never imported by the editor or homepage.
  if (location.href !== pageUrl || !/MicroMessenger/i.test(navigator.userAgent))
    return;
  try {
    const response = await fetch(
      "/api/wechat/jssdk?url=" + encodeURIComponent(pageUrl),
      { credentials: "omit", referrerPolicy: "no-referrer" },
    );
    if (!response.ok) throw new Error("unavailable");
    const signature = await response.json();
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";
      script.referrerPolicy = "no-referrer";
      const timer = setTimeout(() => reject(new Error("timeout")), 8000);
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("sdk"));
      };
      document.head.append(script);
    });
    const wx = (window as unknown as { wx: Wx }).wx;
    const failure = () => {
      setStatus(
        "暂时无法设置分享卡片，请稍后重新打开本页。你仍可以打开 2Space。",
      );
    };
    const timeout = setTimeout(failure, 10000);
    wx.error(() => {
      clearTimeout(timeout);
      failure();
    });
    wx.ready(() => {
      refreshWechatCard = () => {
        const data = {
          title: t("2Space · 这边复制，那边就有。"),
          desc: t("一段文字、一份代码，随手放下，换台设备接着用。"),
          link: "https://2space.cn/",
          imgUrl: "https://2space.cn/share-cover.png",
        };
        wx.updateAppMessageShareData({
          ...data,
          success: () => {
            clearTimeout(timeout);
            setStatus("分享卡片已准备好。点右上角「…」，选择「转发给朋友」。");
          },
          fail: () => {
            clearTimeout(timeout);
            failure();
          },
        });
        wx.updateTimelineShareData(data);
      };
      refreshWechatCard();
    });
    wx.config({
      ...signature,
      debug: false,
      jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"],
    });
  } catch {
    setStatus(
      "暂时无法设置分享卡片，请稍后重新打开本页。你仍可以打开 2Space。",
    );
  }
}
void setup();
