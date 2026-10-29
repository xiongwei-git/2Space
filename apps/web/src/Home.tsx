import { useState } from "react";
import Icon from "./Icon.js";
import { randomExperienceName } from "./view-model.js";
export function Brand() {
  return (
    <a className="logo" href="/" aria-label="2Space 首页">
      <span className="logo-mark" aria-hidden="true">
        <Icon name="clipboard" />
      </span>
      <span>2Space</span>
    </a>
  );
}
const features = [
  ["globe", "免注册即用", "无需账号、无需安装，打开浏览器输入名称即用。"],
  [
    "refresh",
    "跨设备同步",
    "手机、电脑、平板访问同一链接，文字随处可取、随处可改。",
  ],
  ["zap", "自动保存", "输入即保存，关闭前确认保存状态，也可一键下载TXT备份。"],
  ["lock", "密码保护", "为整个剪贴板设置访问密码，让知道密码的人继续使用。"],
  ["eye", "仅查看链接", "以仅查看模式展示内容，方便对方阅读和复制。"],
  ["qr", "二维码分享", "可编辑、仅查看两组二维码，扫码即可打开。"],
];
const cases = [
  [
    "phone",
    "手机 ⇄ 电脑互传文字",
    "手机上复制的文字，换台设备打开同名剪贴板即可取用。",
  ],
  ["code", "代码与配置中转", "命令、SQL、配置片段，保留缩进与换行。"],
  ["list", "临时备忘与清单", "地址、购物清单、待办事项，收藏链接随时打开。"],
  ["share", "分享内容给他人", "把链接或二维码发给对方，无需注册即可查看。"],
];
const faqs = [
  [
    "什么是2Space在线剪贴板？",
    "2Space是一款在线剪贴板与便签工具。输入名称即可打开同名空间，在手机、电脑和平板之间传递文字、代码和常用富文本格式。",
  ],
  [
    "使用2Space需要注册或下载吗？",
    "不需要。打开浏览器即可使用，无需安装客户端或插件。",
  ],
  [
    "2Space是免费的吗？",
    "创建、编辑、密码保护、链接分享、二维码和文本下载均可直接使用。",
  ],
  [
    "如何在手机和电脑之间传输文字？",
    "在一台设备输入名称并粘贴内容，等待显示“已保存”，再在另一台设备打开相同链接即可查看和复制。",
  ],
  [
    "别人能看到我的剪贴板内容吗？",
    "新剪贴板知道名称即可查看和修改。请使用不易猜到的名称，并为需要限制访问的内容设置密码。仅查看链接只改变页面模式，知道名称的人仍可打开可编辑页面。旧的独立链接空间仍保留原有权限。",
  ],
  [
    "我的数据安全吗？",
    "可以设置整个空间的访问密码。不要存放账号密码、银行卡号等高度敏感信息；使用完毕及时清空或删除。新剪贴板不是仅自己可见的保险箱。",
  ],
  [
    "一个剪贴板最多能存多少内容？",
    "每个空间最多6个记事本，单个记事本约200KB文字；格式较复杂时可用字数会减少。超出容量时会提示，请拆分保存。",
  ],
  [
    "剪贴板内容会过期吗？",
    "新剪贴板默认永久保留，可设置30分钟至3年的保留时长。每次保存内容会重新计时，打开查看不会延长保留时间。",
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
          <div className="home-container">
            <span className="hero-badge">✓ 免注册 · 无需下载客户端</span>
            <h1>
              免费在线剪贴板，<em>一个链接</em>实现跨设备复制粘贴
            </h1>
            <p className="hero-sub">
              2Space是一款在线剪贴板与便签工具：输入名称即可获得专属链接，在手机、电脑、平板之间同步文字、代码与常用格式。
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
                      : "进入剪贴板"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              <p className="form-hint">
                {lockedName ? (
                  "请使用分享者提供的完整链接或访问码。"
                ) : (
                  <>
                    没有想法？
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => onEnter(randomExperienceName())}
                    >
                      随机体验一个 →
                    </button>
                  </>
                )}
              </p>
            </form>
            <p className="public-rule">
              知道名称的人可以查看和修改，设置密码可限制访问。
            </p>
            <div className="trust-chips">
              <span>✓ 免注册即用</span>
              <span>
                <Icon name="lock" /> 可选密码保护
              </span>
              <span>
                <Icon name="refresh" /> 跨设备同步
              </span>
              <span>
                <Icon name="download" /> 文字与代码格式
              </span>
            </div>
          </div>
        </section>
        <section className="home-section" id="how">
          <div className="home-container">
            <div className="section-head">
              <span className="kicker">快速上手</span>
              <h2>三步上手，快速1秒搞定</h2>
              <p>不需要注册，也不需要下载任何软件，记住你的链接就够了。</p>
            </div>
            <div className="steps">
              {[
                [
                  "clipboard",
                  "取一个名字",
                  <>
                    输入字母、数字、下划线或中划线名称，如
                    <code>team-notes</code>，打开即得到专属地址。
                  </>,
                ],
                [
                  "zap",
                  "粘贴内容",
                  <>
                    把文字、代码或网页片段粘贴进编辑框，内容自动保存，无需手动点保存。
                  </>,
                ],
                [
                  "phone",
                  "随处访问",
                  <>
                    在其他设备打开相同链接，即可查看、复制；也可以分享链接或二维码。
                  </>,
                ],
              ].map(([icon, title, body], index) => (
                <article className="step" key={index}>
                  <span className="step-index" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={String(icon)} />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="features">
          <div className="home-container">
            <div className="section-head">
              <span className="kicker">核心功能</span>
              <h2>为高频跨设备传输而设计</h2>
              <p>每一个功能都围绕“更快地在设备之间搬运文字”这一件事。</p>
            </div>
            <div className="features">
              {features.map(([icon, title, body]) => (
                <article className="feature" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={String(icon)} />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="home-section" id="cases">
          <div className="home-container">
            <div className="section-head">
              <span className="kicker">使用场景</span>
              <h2>他们都用2Space传什么？</h2>
            </div>
            <div className="cases">
              {cases.map(([icon, title, body]) => (
                <article className="case" key={title}>
                  <span className="feature-icon" aria-hidden="true">
                    <Icon name={String(icon)} />
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
        <section className="home-section" id="compare">
          <div className="home-container">
            <div className="section-head">
              <span className="kicker">为什么选择我们</span>
              <h2>常见文本传输方式对比</h2>
              <p>
                系统剪贴板用于本机，聊天软件用于沟通，云文档适合长文协作。2Space让临时传递更直接。
              </p>
            </div>
            <div
              className="compare-wrap"
              tabIndex={0}
              role="region"
              aria-label="功能对比表"
            >
              <table className="compare-table">
                <caption>常见文本传输方式的使用特点</caption>
                <thead>
                  <tr>
                    {[
                      "能力",
                      "2Space",
                      "即时通讯软件",
                      "系统剪贴板",
                      "在线云文档",
                    ].map((x) => (
                      <th key={x} scope="col">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["无需注册登录", "✓", "通常需要", "✓", "通常需要"],
                    ["跨设备同步文字", "✓", "✓", "依系统而定", "✓"],
                    ["专属链接直达", "✓", "依产品而定", "—", "✓"],
                    ["访问密码", "✓", "依产品而定", "—", "依产品而定"],
                    ["轻量临时中转", "✓", "✓", "✓", "✓"],
                  ].map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, index) =>
                        index === 0 ? (
                          <th scope="row" key={index}>
                            {cell}
                          </th>
                        ) : (
                          <td key={index}>{cell}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="compare-note">
              不同产品和系统能力有所差异，具体以所用版本为准。
            </p>
          </div>
        </section>
        <section className="home-section" id="faq">
          <div className="home-container narrow">
            <div className="section-head">
              <span className="kicker">常见问题</span>
              <h2>关于2Space在线剪贴板的常见疑问</h2>
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
        <section className="home-section">
          <div className="home-container">
            <div className="cta">
              <h2>现在，1秒创建你的第一个剪贴板</h2>
              <p>打开就用——手机、电脑、平板之间搬文字。</p>
              <button
                className="btn secondary"
                onClick={() => onEnter(randomExperienceName())}
              >
                打开2Space →
              </button>
            </div>
          </div>
        </section>
        <section className="home-section" id="support">
          <div className="home-container">
            <div className="support-card">
              <span className="support-icon" aria-hidden="true">
                <Icon name="heart" />
              </span>
              <h2>喜欢2Space，就推荐给朋友</h2>
              <p>
                如果它帮你省下了来回传文字的时间，把这个小工具分享给身边需要的人。
              </p>
              <button className="btn primary" onClick={onSupport}>
                ♥ 支持2Space
              </button>
              <p className="support-note">
                打开分享方式，复制首页链接或分享给朋友。
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <div className="home-container footer-grid">
          <div>
            <Brand />
            <p>
              轻量的在线剪贴板与便签工具。输入名称，随时打开，跨设备传递文字。
            </p>
            <span className="version">v1.0</span>
          </div>
          <nav aria-label="产品导航">
            <h2>产品</h2>
            <a href="#features">核心功能</a>
            <a href="#cases">使用场景</a>
            <a href="#compare">功能对比</a>
            <a href="#faq">常见问题</a>
            <button
              className="inline-button"
              onClick={() => onEnter(randomExperienceName())}
            >
              立即体验
            </button>
          </nav>
          <div>
            <h2>支持与条款</h2>
            <button className="inline-button" onClick={onSupport}>
              支持2Space
            </button>
            <details
              open={privacyOpen}
              onToggle={(event) => setPrivacyOpen(event.currentTarget.open)}
            >
              <summary>隐私政策</summary>
              <p>
                新剪贴板凭名称即可读写；设置密码可限制访问。正文会保存在服务器，请勿存放高度敏感信息。旧独立链接空间保留原有访问限制。删除不能收回别人已复制的内容。
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
          <span>© {new Date().getFullYear()} 2Space · 在线剪贴板工具</span>
          <span>用完及时清空，重要内容请备份。</span>
        </div>
      </footer>
    </>
  );
}
