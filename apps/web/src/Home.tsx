import LanguageSelect from "./LanguageSelect.js";
import { t } from "./locale.js";
import { useState } from "react";
import "./home.css";
import Icon from "./Icon.js";
import { randomExperienceName } from "./view-model.js";
import { Brand, BRAND_SLOGAN } from "./Brand.js";
export { Brand } from "./Brand.js";

const features = [
  [
    "globe",
    "打开就能用",
    "不用注册或安装。取个名称，就有一个随时能打开的地址。",
  ],
  [
    "refresh",
    "换台设备，接着用",
    "打开同一个链接，查看、编辑和复制刚刚放下的内容。",
  ],
  ["zap", "写完自动保存", "不用寻找保存按钮。看到“已保存”，再放心关闭页面。"],
  [
    "lock",
    "需要时加个密码",
    "为整个剪贴板设置密码，其他设备输入密码后才能打开。",
  ],
  [
    "eye",
    "给对方一个阅读页面",
    "仅查看链接方便阅读和复制，页面中不显示编辑工具。",
  ],
  ["qr", "扫一下，也能打开", "手机不方便输入链接时，用二维码接着看。"],
];
const cases = [
  [
    "phone",
    "手机里的地址，电脑上用",
    "把地址、路线或一段回复放下来，在另一台设备直接复制。",
  ],
  [
    "code",
    "一段代码，换个地方继续",
    "命令、配置和代码片段保留缩进，不必重新整理。",
  ],
  [
    "list",
    "零散的事，先放在一起",
    "清单、备忘和临时想法，可以分在不同记事本里。",
  ],
  [
    "share",
    "要给别人的内容，发个链接",
    "一段说明或几份笔记，用同一个链接一起分享。",
  ],
];
const usageTopics = [
  {
    icon: "phone",
    title: "换设备前",
    items: [
      [
        "会自动读取我的系统剪贴板吗？",
        "不会。请先把文字粘贴到这里，等显示“已保存”，再在另一台设备打开同一个名称或链接。",
      ],
      [
        "粘贴过来的格式会怎样？",
        "保留标题、加粗、列表和链接等常用格式。代码放进代码块，可保留缩进并选择高亮语言；表格转为逐行文字，图片不保留。最多6个记事本，每个约200KB文字。",
      ],
    ],
  },
  {
    icon: "share",
    title: "发给别人前",
    items: [
      [
        "“仅查看”能阻止别人修改吗？",
        "用名称打开的剪贴板中，“仅查看”只隐藏编辑工具。知道名称的人仍能打开可编辑页面。",
      ],
      [
        "怎么限制别人打开？",
        "先在剪贴板中设置密码，再把密码单独告诉需要的人。请勿存放账号密码、银行卡号等敏感信息。别人已复制的内容无法收回。",
      ],
    ],
  },
  {
    icon: "clock",
    title: "关掉页面前",
    items: [
      [
        "还没显示“已保存”，能关闭吗？",
        "先别关闭。等待保存完成；如果网络中断或保存失败，先复制内容留作备份，再重试保存。",
      ],
      [
        "两台设备同时修改，会覆盖彼此的内容吗？",
        "如果另一台设备先保存了同一篇笔记，2Space 会暂停本次保存，提示你选择要保留的内容。看到提示时，先检查两边的修改。",
      ],
      [
        "到期时间从什么时候算？",
        "默认永久保留。选择保留时间后，每次保存内容都会重新计时，打开查看不会延长。到期会删除全部记事本，无法恢复；重要内容请另行备份。",
      ],
    ],
  },
];
const privacyQuestions = [
  [
    "忘记密码了，还能找回内容吗？",
    "如果使用新版密码保护，忘记密码后无法找回内容。请使用较长且不重复的密码，并妥善保存。设置密码后，长时间不操作会锁定页面。",
  ],
  [
    "链接或二维码被转发，有什么风险？",
    "按名称使用的剪贴板，未设密码时，知道名称的人可以查看和修改全部记事本。链接和二维码可以被继续转发，分享前请检查所有记事本；名称中不要放姓名、手机号等个人信息。",
  ],
  [
    "共用设备和浏览器插件，会带来风险吗？",
    "会。打开的页面、浏览器历史、剪贴板和下载文件都可能留下内容或入口，未保存的修改也可能暂存在浏览器中。恶意插件、受感染的设备或屏幕共享也可能泄露内容。用完共用设备后，请关闭页面并清理相关记录。",
  ],
  [
    "删除、到期或改密码后，内容就彻底消失了吗？",
    "不能保证。删除或到期会移除剪贴板中的内容，但他人已复制、下载或截图的内容无法收回，浏览器和备份中也可能保留副本。更改密码不能清除这些副本，删除也不代表所有副本立即消失。",
  ],
  [
    "还会留下哪些访问信息？",
    "会记录剪贴板的创建、修改、最近访问时间和查看次数，页面也会显示本次访问IP。不需要账号，不等于访问过程不会留下记录。",
  ],
  [
    "哪些个人信息不适合放在这里？",
    "请勿存放账号密码、验证码、证件号码、银行卡信息或未获授权的客户资料。只放确实需要临时中转的内容，使用后及时删除；重要资料请另行备份。",
  ],
];
interface Props {
  busy: boolean;
  name: string;
  onName: (value: string) => void;
  onEnter: (name: string) => void;
  onSupport: () => void;
  onBookmark: () => void;
  lockedName: string;
  accessCode: string;
  onCode: (value: string) => void;
  onOpenCode: () => void;
}
export default function Home({
  busy,
  name,
  onName,
  onEnter,
  onSupport,
  onBookmark,
  lockedName,
  accessCode,
  onCode,
  onOpenCode,
}: Props) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <>
      <a className="skip-link" href="#main">
        {t("跳到主要内容")}
      </a>
      <header className="site-header">
        <div className="home-container header-inner">
          <Brand />
          <nav className="nav" aria-label={t("主导航")}>
            <a className="nav-link" href="#features">
              {t("核心功能")}
            </a>
            <a className="nav-link" href="#cases">
              {t("使用场景")}
            </a>
            <a className="nav-link" href="#faq">
              {t("常见问题")}
            </a>
            <a className="nav-link support-link" href="#support">
              {t("♥ 支持我们")}
            </a>
            <button
              className="btn ghost home-bookmark"
              onClick={onBookmark}
              aria-label={t("收藏首页")}
            >
              <Icon name="bookmark" />
              <span className="bookmark-label">{t("收藏")}</span>
            </button>
            <button
              className="btn primary"
              onClick={() => onEnter(randomExperienceName())}
            >
              {t("立即体验")}
            </button>
            <LanguageSelect />
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="home-container hero-layout">
            <div className="hero-copy">
              <h1 data-brand-slogan>{t(BRAND_SLOGAN)}</h1>
              <p className="hero-sub">
                {t("文字、代码、网页片段。放进同一个链接，换台设备接着用。")}
              </p>
              <form
                className="form-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  lockedName ? onOpenCode() : onEnter(name);
                }}
              >
                <label htmlFor={lockedName ? "spaceAccessCode" : "spaceName"}>
                  {lockedName
                    ? t("打开 {0}，请输入访问码", lockedName)
                    : t("创建或打开你的剪贴板")}
                </label>
                {lockedName ? (
                  <input
                    className="input"
                    id="spaceAccessCode"
                    value={accessCode}
                    onChange={(e) => onCode(e.target.value)}
                    placeholder={t("粘贴访问码或完整链接")}
                    autoComplete="off"
                  />
                ) : (
                  <div className="input-wrap">
                    <span className="prefix">2space.cn/</span>
                    <input
                      id="spaceName"
                      value={name}
                      onChange={(e) => onName(e.target.value)}
                      maxLength={64}
                      placeholder={t("例如：team-notes")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}
                <div className="form-actions">
                  <button className="btn primary" disabled={busy}>
                    {busy
                      ? t("正在打开…")
                      : lockedName
                        ? t("打开已有空间")
                        : t("进入剪贴板")}
                  </button>
                </div>
                <p className="form-hint">
                  {lockedName ? (
                    t("请使用分享者提供的完整链接或访问码。")
                  ) : (
                    <>
                      {t("不想起名？")}
                      <button
                        type="button"
                        className="inline-button"
                        onClick={() => onEnter(randomExperienceName())}
                      >
                        {t("随机体验一个")}
                      </button>
                    </>
                  )}
                </p>
              </form>
              <p className="public-rule">
                <Icon name="lock" />
                {t("知道名称的人可以查看和修改，设置密码可限制访问。")}
              </p>
              <p className="encryption-note">
                {location.protocol === "https:" && (
                  <span>{t("HTTPS 加密传输")}</span>
                )}
                <span>{t("内容加密存储")}</span>
              </p>
            </div>
            <figure
              className="transfer-demo"
              aria-label={t("同一份内容在电脑和手机上打开的示意")}
            >
              <div className="demo-desktop">
                <div className="demo-window-bar">
                  <Icon name="globe" />
                  <span>2space.cn/travel-notes</span>
                </div>
                <div className="demo-document">
                  <span className="demo-device-label">{t("在电脑上放下")}</span>
                  <h2>{t("周五下班后")}</h2>
                  <p>{t("周五 18:30，南站见。")}</p>
                  <ul>
                    <li>{t("去吃小厨娘")}</li>
                    <li>{t("然后百家湖逛逛")}</li>
                  </ul>
                  <div className="demo-saved">
                    <span aria-hidden="true">✓</span>
                    {t("已保存")}
                  </div>
                </div>
              </div>
              <div className="demo-phone">
                <div className="demo-phone-top">
                  <Icon name="phone" />
                  <span>{t("在手机上接着看")}</span>
                </div>
                <div className="demo-document">
                  <h2>{t("周五下班后")}</h2>
                  <p>{t("周五 18:30，南站见。")}</p>
                  <ul>
                    <li>{t("去吃小厨娘")}</li>
                    <li>{t("然后百家湖逛逛")}</li>
                  </ul>
                </div>
              </div>
              <figcaption className="demo-caption">
                {t("同一个链接，同一份内容。")}
              </figcaption>
            </figure>
          </div>
        </section>
        <section className="home-section" id="how">
          <div className="home-container how-layout">
            <div className="section-head">
              <h2>{t("从这里放下，到那里取用。")}</h2>
              <p>{t("不必给自己发消息，也不用新建一份长文档。")}</p>
            </div>
            <div className="steps">
              {[
                [
                  t("取一个名字"),
                  t(
                    "输入字母、数字、下划线或中划线。记住名称，也就记住了链接。",
                  ),
                ],
                [t("粘贴进去"), t("放下文字或代码，等页面显示“已保存”。")],
                [
                  t("换台设备打开"),
                  t("输入相同地址，或扫描二维码，继续查看、复制和编辑。"),
                ],
              ].map(([title, body], index) => (
                <article className="step" key={title}>
                  <span className="step-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(body)}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="features">
          <div className="home-container feature-layout">
            <div className="section-head">
              <h2>{t("把传内容这件事，做得简单一点。")}</h2>
              <p>{t("常用的功能都在手边，打开就知道怎么用。")}</p>
            </div>
            <div className="features">
              {features.map(([icon, title, body]) => (
                <article className="feature" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(body)}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="privacy-callout">
              <Icon name="lock" />
              <div>
                <h3>{t("访问范围，说清楚。")}</h3>
                <p>
                  {t(
                    "名称就是入口，知道名称的人可以查看和修改。需要限制访问时，先设置密码。仅查看链接方便阅读，不代表内容只有对方能看。",
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="home-section" id="compare">
          <div className="home-container format-layout">
            <div className="section-head">
              <h2>{t("一段文字，一份代码，都有合适的样子。")}</h2>
              <p>
                {t(
                  "复制来的常用格式可以保留。代码有自己的位置，缩进、换行也一起带过去。",
                )}
              </p>
            </div>
            <article className="format-sample format-prose">
              <div className="format-label">
                <Icon name="clipboard" />
                {t("文字与常用格式")}
              </div>
              <h3>{t("把要点留清楚")}</h3>
              <p>{t("标题、重点、列表和链接，粘贴后继续整理。")}</p>
              <ul>
                <li>{t("今天要处理的两件事")}</li>
                <li>{t("一段值得留下的网页摘录")}</li>
              </ul>
            </article>
            <article className="format-sample format-code">
              <div className="format-label">
                <Icon name="code" />
                {t("代码与配置")}
              </div>
              <pre tabIndex={0} aria-label={t("代码格式示例")}>
                <code>
                  {
                    'const space = "2space";\n\nfunction keepGoing(text) {\n  return text.trim();\n}'
                  }
                </code>
              </pre>
              <p>{t("保留缩进，按语言高亮，也能直接复制原文。")}</p>
            </article>
          </div>
        </section>
        <section className="home-section" id="cases">
          <div className="home-container cases-layout">
            <div className="section-head">
              <h2>{t("手边的内容，随时有地方放。")}</h2>
            </div>
            <div className="cases">
              {cases.map(([icon, title, body]) => (
                <article className="case" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(body)}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="faq">
          <div className="home-container usage-guide">
            <div className="section-head">
              <h2>{t("几件容易弄混的事。")}</h2>
              <p>{t("换设备、发链接、关页面之前，先看清楚这些规则。")}</p>
            </div>
            <div className="usage-guide-grid">
              {usageTopics.map(({ icon, title, items }) => (
                <article className="usage-topic" key={title}>
                  <h3>
                    <Icon name={icon} />
                    {t(title)}
                  </h3>
                  <dl>
                    {items.map(([question, answer]) => (
                      <div key={question}>
                        <dt>{t(question)}</dt>
                        <dd>{t(answer)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
            <section
              className="privacy-guide"
              aria-labelledby="privacy-guide-title"
              id="privacy-faq"
            >
              <div className="section-head">
                <h3 id="privacy-guide-title">{t("隐私与安全")}</h3>
                <p>{t("先了解保护的范围，再决定放什么、分享给谁。")}</p>
              </div>
              <div className="protection-explainer">
                <figure className="protection-flow">
                  <figcaption>{t("一张便签的加密之旅")}</figcaption>
                  <p>{t("以使用新版密码保护的剪贴板为例。")}</p>
                  <ol role="list">
                    <li>
                      <img
                        src="/illustrations/encryption-computer.webp"
                        alt=""
                        loading="lazy"
                      />
                      <strong>{t("电脑先加密")}</strong>
                      <p>{t("浏览器把「18:30」加密成一串符号，再发送。")}</p>
                      <Icon name="arrow" className="protection-arrow" />
                    </li>
                    <li>
                      <img
                        src="/illustrations/encryption-server.webp"
                        alt=""
                        loading="lazy"
                      />
                      <strong>{t("服务器保存加密内容")}</strong>
                      <p>
                        {t(
                          "服务器存下加密后的符号，解密所需的钥匙留在浏览器。",
                        )}
                      </p>
                      <Icon name="arrow" className="protection-arrow" />
                    </li>
                    <li>
                      <img
                        src="/illustrations/encryption-phone.webp"
                        alt=""
                        loading="lazy"
                      />
                      <strong>{t("手机输入密码后解密")}</strong>
                      <p>{t("手机浏览器用密码解密，你又能看到「18:30」。")}</p>
                    </li>
                  </ol>
                </figure>
                <div className="protection-modes">
                  <div>
                    <h4>{t("未设置密码")}</h4>
                    <p>
                      {t("内容加密存储。知道剪贴板名称的人可以查看和修改。")}
                    </p>
                  </div>
                  <div>
                    <h4>{t("使用新版密码保护")}</h4>
                    <p>
                      {t(
                        "密码和解密所需的钥匙都留在浏览器里。换设备时，需要输入密码才能打开。",
                      )}
                    </p>
                  </div>
                </div>
                <details className="protection-details">
                  <summary>{t("查看加密技术细节")}</summary>
                  {location.protocol === "https:" && (
                    <p>{t("HTTPS 保护浏览器与服务器之间的传输。")}</p>
                  )}
                  <p>
                    {t(
                      "使用新版密码保护时，浏览器通过 PBKDF2-SHA256 和 HKDF-SHA256\n                    从密码生成两份独立的数据。一份用于 AES-256-GCM\n                    加解密内容，另一份用于向服务器验证访问。",
                    )}
                  </p>
                  <p>
                    {t(
                      "未设密码的剪贴板由服务器保存解密所需的钥匙。旧版密码保护仍按原有方式运行，重新设置密码后才启用新版保护。",
                    )}
                  </p>
                </details>
              </div>
              <dl className="privacy-questions">
                {privacyQuestions.map(([question, answer]) => (
                  <div className="privacy-question" key={question}>
                    <dt>{t(question)}</dt>
                    <dd>{t(answer)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </section>
        <section className="home-section" id="support">
          <div className="home-container support-layout">
            <div className="support-card">
              <div>
                <h2>{t("顺手的话，也分享给朋友。")}</h2>
                <p>{t("把2Space的首页发给需要在设备间传文字的人。")}</p>
              </div>
              <button className="btn primary" onClick={onSupport}>
                {t("♥ 支持2Space")}
              </button>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <div className="home-container footer-grid">
          <div>
            <Brand />
            <p>{t("这边复制，那边就有。")}</p>
          </div>
          <nav aria-label={t("产品导航")}>
            <h2>{t("开始使用")}</h2>
            <a href="#features">{t("核心功能")}</a>
            <a href="#cases">{t("使用场景")}</a>
            <a href="#compare">{t("文字与代码")}</a>
            <a href="#faq">{t("常见问题")}</a>
            <button
              className="inline-button"
              onClick={() => onEnter(randomExperienceName())}
            >
              {t("立即体验")}
            </button>
          </nav>
          <div>
            <h2>{t("关于2Space")}</h2>
            <button className="inline-button" onClick={onSupport}>
              {t("支持2Space")}
            </button>
            <details
              open={privacyOpen}
              onToggle={(event) => setPrivacyOpen(event.currentTarget.open)}
            >
              <summary>{t("隐私政策")}</summary>
              <p>
                {t(
                  "知道名称的人可以查看和修改；设置密码可限制访问。内容以加密形式保存在服务器，请勿存放高度敏感信息。原有独立链接保留原来的访问限制。删除不能收回别人已复制的内容。",
                )}
              </p>
            </details>
            <details>
              <summary>{t("使用条款")}</summary>
              <p>
                {t(
                  "请勿存储或传播违法、侵权或有害内容。重要内容请自行备份；请合理使用，不要恶意刷量。",
                )}
              </p>
            </details>
          </div>
        </div>
        <div className="home-container footer-bottom">
          <span>© {new Date().getFullYear()} 2Space</span>
          <span>{t("重要内容，请另行备份。")}</span>
        </div>
      </footer>
    </>
  );
}
