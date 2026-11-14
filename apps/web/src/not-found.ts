import {
  createLanguageSelect,
  currentLocale,
  subscribeLocale,
  t,
} from "./locale.js";
import "./standalone.css";

function render() {
  const heading = t("页面不存在");
  document.documentElement.lang = currentLocale();
  document.title = heading + " · 2Space";
  document.getElementById("heading")!.textContent = heading;
  document.getElementById("home")!.textContent = t("返回首页");
}
document.getElementById("language-control")!.append(createLanguageSelect());
subscribeLocale(render);
render();
