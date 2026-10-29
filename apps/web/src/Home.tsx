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
const faqs = [
  [
    "2Space适合做什么？",
    "在手机、电脑和平板之间传文字、网页片段或代码，也可以临时记下内容，再把链接分享给别人。",
  ],
  [
    "打开之前，需要准备什么？",
    "有浏览器就可以。不用注册、安装客户端或添加插件。",
  ],
  [
    "2Space是免费的吗？",
    "创建剪贴板、编辑、设置密码、分享链接、扫码打开和下载文字都可以直接使用。",
  ],
  [
    "怎么在两台设备之间接着用？",
    "在第一台设备输入名称并粘贴内容，看到“已保存”后，在另一台设备打开相同链接，就能查看和复制。",
  ],
  [
    "别人能看到我的剪贴板内容吗？",
    "知道名称的人可以查看和修改。需要限制访问时，请设置密码。仅查看链接只提供阅读页面；知道名称的人仍能另行打开可编辑页面。原有独立链接继续保留原来的访问限制。",
  ],
  [
    "我的数据安全吗？",
    "密码可以限制其他人打开剪贴板，但请勿存放账号密码、银行卡号等高度敏感信息。重要内容另行备份。删除后，别人已经复制的内容也无法收回。",
  ],
  [
    "一个剪贴板最多能存多少内容？",
    "最多6个记事本，每个约200KB文字。格式越复杂，可用字数越少；超出容量时会提示你拆分内容。",
  ],
  [
    "剪贴板内容会过期吗？",
    "默认永久保留，也可以选择30分钟至3年的保留时间。每次保存内容会重新计时；只打开查看，不会延长时间。到期后，整个剪贴板和其中的记事本都会删除。",
  ],
];
interface Props {
  busy: boolean;
  name: string;
  onName: (value: string) => void;
  onEnter: (name: string) => void;
  onSupport: () => void;
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
  lockedName,
  accessCode,
  onCode,
  onOpenCode,
}: Props) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="home-container header-inner">
          <Brand />
          <nav className="nav" aria-label="主导航">
            <a className="nav-link" href="#features">
              核心功能
            </a>
            <a className="nav-link" href="#cases">
              使用场景
            </a>
            <a className="nav-link" href="#faq">
              常见问题
            </a>
            <a className="nav-link support-link" href="#support">
              ♥ 支持我们
            </a>
            <button
              className="btn primary"
              onClick={() => onEnter(randomExperienceName())}
            >
              立即体验
            </button>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="home-container hero-layout">
            <div className="hero-copy">
              <h1 data-brand-slogan>{BRAND_SLOGAN}</h1>
              <p className="hero-sub">
                文字、代码、网页片段。放进同一个链接，换台设备接着用。
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
                    ? `打开 ${lockedName}，请输入访问码`
                    : "创建或打开你的剪贴板"}
                </label>
                {lockedName ? (
                  <input
                    className="input"
                    id="spaceAccessCode"
                    value={accessCode}
                    onChange={(e) => onCode(e.target.value)}
                    placeholder="粘贴访问码或完整链接"
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
                      placeholder="例如：team-notes"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}
                <div className="form-actions">
                  <button className="btn primary" disabled={busy}>
                    {busy
                      ? "正在打开…"
                      : lockedName
                        ? "打开已有空间"
                        : "进入剪贴板"}
                  </button>
                </div>
                <p className="form-hint">
                  {lockedName ? (
                    "请使用分享者提供的完整链接或访问码。"
                  ) : (
                    <>
                      不想起名？
                      <button
                        type="button"
                        className="inline-button"
                        onClick={() => onEnter(randomExperienceName())}
                      >
                        随机体验一个
                      </button>
                    </>
                  )}
                </p>
              </form>
              <p className="public-rule">
                <Icon name="lock" />
                知道名称的人可以查看和修改，设置密码可限制访问。
              </p>
            </div>
            <figure
              className="transfer-demo"
              aria-label="同一份内容在电脑和手机上打开的示意"
            >
              <div className="demo-desktop">
                <div className="demo-window-bar">
                  <Icon name="globe" />
                  <span>2space.cn/travel-notes</span>
                </div>
                <div className="demo-document">
                  <span className="demo-device-label">在电脑上放下</span>
                  <h2>周末出发</h2>
                  <p>周六 09:30，南站见。</p>
                  <ul>
                    <li>带好相机和充电线</li>
                    <li>午餐试试那家面馆</li>
                  </ul>
                  <div className="demo-saved">
                    <span aria-hidden="true">✓</span>
                    已保存
                  </div>
                </div>
              </div>
              <div className="demo-phone">
                <div className="demo-phone-top">
                  <Icon name="phone" />
                  <span>在手机上接着看</span>
                </div>
                <div className="demo-document">
                  <h2>周末出发</h2>
                  <p>周六 09:30，南站见。</p>
                  <ul>
                    <li>带好相机和充电线</li>
                    <li>午餐试试那家面馆</li>
                  </ul>
                </div>
              </div>
              <figcaption className="demo-caption">
                同一个链接，同一份内容。
              </figcaption>
            </figure>
          </div>
        </section>
        <section className="home-section" id="how">
          <div className="home-container how-layout">
            <div className="section-head">
              <h2>从这里放下，到那里取用。</h2>
              <p>不必给自己发消息，也不用新建一份长文档。</p>
            </div>
            <div className="steps">
              {[
                [
                  "取一个名字",
                  "输入字母、数字、下划线或中划线。记住名称，也就记住了链接。",
                ],
                ["粘贴进去", "放下文字或代码，等页面显示“已保存”。"],
                [
                  "换台设备打开",
                  "输入相同地址，或扫描二维码，继续查看、复制和编辑。",
                ],
              ].map(([title, body], index) => (
                <article className="step" key={title}>
                  <span className="step-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="features">
          <div className="home-container feature-layout">
            <div className="section-head">
              <h2>把传内容这件事，做得简单一点。</h2>
              <p>常用的功能都在手边，打开就知道怎么用。</p>
            </div>
            <div className="features">
              {features.map(([icon, title, body]) => (
                <article className="feature" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="privacy-callout">
              <Icon name="lock" />
              <div>
                <h3>访问范围，说清楚。</h3>
                <p>
                  名称就是入口，知道名称的人可以查看和修改。需要限制访问时，先设置密码。仅查看链接方便阅读，不代表内容只有对方能看。
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="home-section" id="compare">
          <div className="home-container format-layout">
            <div className="section-head">
              <h2>一段文字，一份代码，都有合适的样子。</h2>
              <p>
                复制来的常用格式可以保留。代码有自己的位置，缩进、换行也一起带过去。
              </p>
            </div>
            <article className="format-sample format-prose">
              <div className="format-label">
                <Icon name="clipboard" />
                文字与常用格式
              </div>
              <h3>把要点留清楚</h3>
              <p>
                标题、<strong>重点</strong>、列表和链接，粘贴后继续整理。
              </p>
              <ul>
                <li>今天要处理的两件事</li>
                <li>一段值得留下的网页摘录</li>
              </ul>
            </article>
            <article className="format-sample format-code">
              <div className="format-label">
                <Icon name="code" />
                代码与配置
              </div>
              <pre tabIndex={0} aria-label="代码格式示例">
                <code>
                  {
                    'const space = "2space";\n\nfunction keepGoing(text) {\n  return text.trim();\n}'
                  }
                </code>
              </pre>
              <p>保留缩进，按语言高亮，也能直接复制原文。</p>
            </article>
          </div>
        </section>
        <section className="home-section" id="cases">
          <div className="home-container cases-layout">
            <div className="section-head">
              <h2>手边的内容，随时有地方放。</h2>
            </div>
            <div className="cases">
              {cases.map(([icon, title, body]) => (
                <article className="case" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="faq">
          <div className="home-container faq-layout">
            <div className="section-head">
              <h2>还有几个问题。</h2>
              <p>使用方式、保存时间和访问范围，在这里说清楚。</p>
            </div>
            <div className="faq-list">
              {faqs.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <span aria-hidden="true">＋</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="support">
          <div className="home-container support-layout">
            <div className="support-card">
              <div>
                <h2>顺手的话，也分享给朋友。</h2>
                <p>把2Space的首页发给需要在设备间传文字的人。</p>
              </div>
              <button className="btn primary" onClick={onSupport}>
                ♥ 支持2Space
              </button>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <div className="home-container footer-grid">
          <div>
            <Brand />
            <p>这边复制，那边就有。</p>
            <span className="version">v1.0</span>
          </div>
          <nav aria-label="产品导航">
            <h2>开始使用</h2>
            <a href="#features">核心功能</a>
            <a href="#cases">使用场景</a>
            <a href="#compare">文字与代码</a>
            <a href="#faq">常见问题</a>
            <button
              className="inline-button"
              onClick={() => onEnter(randomExperienceName())}
            >
              立即体验
            </button>
          </nav>
          <div>
            <h2>关于2Space</h2>
            <button className="inline-button" onClick={onSupport}>
              支持2Space
            </button>
            <details
              open={privacyOpen}
              onToggle={(event) => setPrivacyOpen(event.currentTarget.open)}
            >
              <summary>隐私政策</summary>
              <p>
                知道名称的人可以查看和修改；设置密码可限制访问。正文保存在服务器，请勿存放高度敏感信息。原有独立链接保留原来的访问限制。删除不能收回别人已复制的内容。
              </p>
            </details>
            <details>
              <summary>使用条款</summary>
              <p>
                请勿存储或传播违法、侵权或有害内容。重要内容请自行备份；请合理使用，不要恶意刷量。
              </p>
            </details>
          </div>
        </div>
        <div className="home-container footer-bottom">
          <span>© {new Date().getFullYear()} 2Space</span>
          <span>重要内容，请另行备份。</span>
        </div>
      </footer>
    </>
  );
}
