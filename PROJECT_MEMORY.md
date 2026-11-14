# 2Space · 项目接续

```yaml
home: macbook
category: personal-durable
runtime: macbook
repository_model: single-repo
source_of_truth: github-origin
git_platform: github
git_visibility: private
origin_role: authoritative
mirror_platform: none
vps_clone_source: none
sensitivity: private
sync: git
shared_memory: none
status: active
last_reviewed: 2026-10-30
```

开发继续由MacBook承载，本机原数据与容器保留。2026-10-30用户已明确授权并完成华纳云新加坡Docker公网部署至2space.cn；生产为独立数据卷，不迁移开发数据，未迁移Mac mini。当前生产状态见文末及docs/PRODUCTION-20261030.md。

## 目标与授权

2026-10-29 用户明确要求开发规范、架构、多个任务并行并直接开始1.0开发。此前“未说开始不动工”的限制已被本轮明确开始指令解除。代码维护在git@github.com:xiongwei-git/2Space.git，原远端为空，已在当前项目根初始化single-repo。

## 确认需求

文本（轻量富文本粘贴保格式、代码格式）；图片改为二期，不支持任意小文件；安全/隐私是核心卖点。Docker开发与部署，本轮只本地调试。品牌2Space，中文“两格”尚是候选。

## 决策与范围

以docs/REQUIREMENTS.md、docs/ARCHITECTURE.md、docs/API.md、docs/DEVELOPMENT.md为准。React/Vite/Tiptap按需编辑器、Fastify、Node24 SQLite、SSE，单体单容器；浏览器AES-GCM正文加密，独立读写能力凭证，默认24h临时空间，最多6页。工程默认不等于用户逐项确认，变化应记录。
T1前端、T2后端、T3 Docker/交付并行同工作区目录隔离；根契约和依赖锁由架构主任务统一管理。状态见docs/TASKS.md。未验证前不得记录为交付完成。

## 历史调研

research/Jianla深度调研-2026-10-28.md保留在本机，research/被Git忽略；第三方源码证据和测试链接不推送。原站功能与问题仅代表当时公开观察，后台未取得。首次调研合成测试板仍可能存在于原站，本轮不访问它。

## 当前交付与验证

1.0开发和本地集成完成，T1/T2/T3并行任务均已交付。TypeScript、17项单元/集成测试、23项Docker页面/资源/API smoke、格式检查通过；npm audit0。生产Docker运行在localhost:3210（loopback），开发容器停止，未部署2space.cn。
浏览器验证富文本/代码/复制下载/多笔记/双页实时更新/只读撤销/断网恢复/真实冲突副本/危险粘贴过滤/390px无横向溢出。仅访问不续期已回归。详情与未验收项见docs/ACCEPTANCE.md。
主JS gzip约90KB，按需编辑器约171KB。运行数据库、截图、研究材料、完整能力链接不进Git。匿名管理链接丢失无法找回；前端脚本/终端风险仍存在，不宣称绝对安全。
后续：用户评审本地版本；实体手机和跨网验收；图片二期未启动。公网部署需另外明确授权。

## 边界

不提交密码/令牌/密钥/完整能力链接/运行数据库/测试会话。2026-10-29用户新增授权共享Web阅读基线与本机全局入口（保留既有profile.md改动），不修改frontend-design。范围为2Space本地试点，不批量修改其他项目、远程设备或公网服务。

## Web阅读基线试点

采用web-reading-v1：正文16px、控件和次要正文14px、12px仅用于明确元信息；Tokens统一管理，自动计算样式/对比度/axe与截图采集接入CI。30组合成场景与关键截图审查、17项功能测试、类型/格式、Docker构建及23项smoke通过。本机3210已更新，数据卷保留；更新前旧容器rootfs、前端和SQLite已备份，备份完整性通过，恢复演练未做。
原生200%/400%缩放因浏览器控制未生效仍未验收；不能用根字体放大/320px等效重排冒称原生缩放通过。其他浏览器未验证；远端CI以GitHub对应提交的实际检查结果为准。共享Web规范已按用户授权同步至小咪（共享提交97ae6f7），全局入口与同版frontend-design已补齐、哈希核对通过；未同步2Space代码或修改小咪业务项目。详情见docs/ACCEPTANCE.md；不宣称全站WCAG AA合规。

## 新一轮：名称与便捷分享

用户在验收并调整UI后要求“空间名称默认随机可填”“链接短”“分享便捷”，授权规划后并行实施。起点f8962f5，Git干净；当前分支feat/named-spaces，不回滚用户的Web阅读/高度/焦点调整。方案与接口见docs/SHORT-LINKS.md、ADR-002，T4/T5/T6已分派。安全保持名称不授权、浏览器加密、独立reader鉴权；短reader能力128bit，服务端只存密钥包装密文。v1普通与密码链接/旧数据兼容，默认分享复用不轮换。新功能已通过28项单元/集成、45项短链与53组阅读交互检查；保留此前用户UI。备份数据库及旧镜像后已更新3210，迁移前后原记录摘要一致，v1 smoke23通过。实际浏览器确认一步复制/22字符reader码/刷新复用/只读展示。未清卷，未做恢复演练或公网部署。

## 当前进行：参考站功能和风格对齐

当前本地分支feat/jianla-parity（交付时更新原PR #1对应的远端feat/named-spaces），检查点98d091e保留文案清理。用户最新明确要求先按Jian.la复制功能/交互/风格；并明确批准新建空间“凭名称即可查看和修改，密码可选”。新public默认永久、短路径/name，?readonly只是页面模式；已有private原样保留，不能迁移为public。最新契约以docs/JIANLA-PARITY.md为准，覆盖旧文档中仅适用于private的默认规则。

T7/T8/T9已交付并停写，本地集成完成。25项后端+17项前端、46项旧链接、78项对照功能、53组浏览器阅读/交互检查通过。root已实际查看首页、桌面/手机编辑、暗色、320px保留弹窗、密码、删除与锁后重开等截图；不把axe自动零违规等同全站WCAG。最后冲突图标role语义补丁同样纳入最终构建验收。

用户产品文案铁律：界面不出现开发/部署/环境说明或无关广告统计宣告；技术术语换成用户理解的权限、动作和结果。根copy:check静态门禁已接入design:check。

### 最终本地运行记录

3210已更新至参考对齐版，只有127.0.0.1映射。更新前SQLite在线备份和旧镜像保留在output/backups/before-reference-final-1793250690及2space:before-reference-final-1793250690；完整性ok。迁移后10个旧空间全部private，14页和2条compact分享及全部原字段（包括名称/envelope）摘要一致。24项含Docker重启smoke通过，合成测试清理；最后静态语义更新后23项smoke再次通过，更新前后全部11空间/15页/2分享摘要一致（多出的1空间为root合成演示）。

最终运行入口与浏览器验收dist asset hash一致，favicon200。实际浏览器确认演示空间刷新后内容仍在、已保存、双二维码显示；output/2space-delivery.png是无真实正文/私密链接的合成运行截图。未清卷、未公网部署、未做数据恢复演练。原生浏览器200%/400%缩放、实体手机和其他浏览器仍未验收；根字体200%、320等效重排与文字间距覆盖已通过。

### 云端检查构建门禁

ca948fe首次云端检查揭示test:links依赖本地已存在web/dist；干净检出未构建前端，裸名SPA入口404。已本地移走dist复现，再改test:links先完整构建web/server，46项通过并移除CI重复build。产品功能和运行数据库不变；后续以修复提交的CI结果为准。

### 最终跨平台与锁后状态修正

云端7370baf浏览器文字200%暴露Linux输入框固有宽度把二维码网格撑出右栏，已用minmax(0,1fr)+qr-box min-width:0修复，不隐藏溢出/降字号。另enter按冲突/dirty初始化保存状态，避免断网修改自动锁后解锁误报已保存；不自动补交。最终56组浏览器回归通过，新增宽字体200%+间距/逐层二维码几何边界、未保存解锁状态与手动保存恰1次PUT证明。root实际看新增截图，字阶与内容完整。

最终Docker补丁更新后11空间/15页/2分享全部字段摘要一致（含1个合成演示空间），23项smoke通过，运行入口asset hash与56组验收dist一致。已保留更新前数据库备份，不清卷。云端以这一修复后的新提交检查为准。

## 当前迭代：恢复品牌与轻量代码编辑

用户基于23557c3明确授权并行实施：恢复原双格logo/原slogan，精简编辑器、突出代码、移除表格。当前分支feat/brand-code-editor。T10品牌拥有Home/Brand/favicon/index；T11编辑器拥有Editor/sanitize/code模块及测试；T12验收拥有scripts与验收/维护文档；root统一Workspace/App/style/依赖锁/其余文档和Docker集成。规则见ADR-004，不改变public/private/API，不清卷。

原品牌来源f8962f5：双格错位图形、主蓝#3159DB、slogan“这边复制，那边就有。”。不恢复旧版不准确的默认私密/默认1天文案。表格转换不得在载入时写回数据库；兼容验证尚待完成，3210尚未更新。

### 品牌/编辑器本地交付结果

T10/T11/T12已交付并停写。统一BrandMark恢复f8962f5双格几何，Home/Workspace/favicon一致；原slogan和原hero短句已恢复，保留便捷访问/分享。Editor默认3操作，代码块含语言/行号/原文复制/缩进与退出。表格扩展已从依赖锁移除；normalizeDocument仅显示转换旧table，不初始化保存。关闭StarterKit.trailingNode，防metadata/selection事务偷偷补段落；plaintext已显式注册，未知语言不自动猜高亮。

50项单元/集成(25server+25web)、67组浏览器阅读/功能、静态字阶与文案通过。root实际查看desktop Home/Editor、320px代码与390px旧表格，代码/行号齐整、原表格所有单元格文字可读；完整axe零自动违规不是全站合规。编辑器gzip154.45KB，较171.4KB下降约10%。

已备份output/backups/before-brand-code-final-1793253907及同名旧镜像标签，然后更新本地3210。15空间/19页/2短分享所有记录摘要一致，SQLite integrity ok；运行入口asset hash与67组构建一致，24项含Docker重启smoke通过。未清卷、未部署公网，原生缩放/实体手机/屏幕阅读器/独立安全审计仍未验收。后续GitHub检查以新提交实际结果为准。

### 云端重复检查的测试选区同步

787c3d8的PR Linux CI全项成功，同代码push CI在新增代码setup某wait超时。旧artifact无该setup失败截图，不能确认具体等待点。交付任务12次局部探针均观察到DOM Range已在首块、PM模型选区尚未同步；现仅在测试准备阶段用Tiptap测试挂载设置选区并核对DOM/model/view焦点，再发送真实Tab/ShiftTab，原功能断言不变。增加细分阶段与失败脱敏截图/布尔诊断；最新本地67再次通过。未改产品或3210，最终两条Linux结果以新测试提交为准。

### 首页导航首次点击修复

用户报告顶部“核心功能”等首次点击仅抖动。实际复现：首页hashchange误触发私密能力链接的整页reload。App改为事件发生时读取当前pathname，仅非首页保留reload，兼容首页创建空间后history.replaceState而不重挂载。新增真实浏览器断言：四个主导航首次点击均滚入目标、零文档导航请求；旧实现先失败证实回归有效。未调整视觉样式或API。

本地Docker已更新，更新前在线SQLite备份及旧镜像保留于output/backups/before-home-navigation-1793256693；16空间/20页/2分享全记录摘要更新前后一致。typecheck、50项单元测试、23项Docker冒烟通过；67组完整浏览器回归通过（含新增四个首页锚点断言与私密owner→reader切换）。

## 当前迭代：整体布局与文案改版

用户明确授权首页导航修复后重新设计整体布局、调整所有文案，取消继续照搬参考风格的限制。设计方向与边界见ADR-005；正文/代码16、控件14、明确元信息12保持。首页任务拥有Home.tsx/home.css，root拥有Workspace/App/公共CSS/文案/测试/文档和Docker集成；不交叉写入。实现与本地验收完成：首页分栏、工作区动作/设置分层、二维码并排和访问记录折叠，弹窗/错误/隐私等文案统一；保留原品牌和现有功能边界。当前分支feat/product-redesign。typecheck、50测试、67浏览器场景与23Docker smoke通过；实际截图和回退细节见ACCEPTANCE末节。3210已更新，更新前16/20/2原记录摘要一致，之后新建独立演示内容。数据库快照与从ccd9089源码重建的回退镜像已保留（旧容器Image配置ID不能直接tag）；未做恢复演练。实体手机/其他浏览器/原生缩放/安全审计仍未验收。

### 本轮修正：使用小抄与空代码块

用户反馈FAQ雷同、空代码块与正文提示重叠。FAQ改为3使用时机/6具体问题的常显说明，桌面三栏/手机单列。Editor提示限定单个空paragraph，避免Tiptap.isEmpty将空codeBlock误判为未开始编辑。先加入真实浏览器回归证实旧代码失败，再修复；创建/输入/删空/切回段落/退出在3视口通过。typecheck、50测试、70浏览器场景、23Docker smoke通过；实际看图与本地操作完成。备份before-guide-code-1793258695和旧镜像可用，原19/23/2记录摘要一致；3210已更新，随后新建独立空代码演示。仍在feat/product-redesign/PR3维护，不改API或权限。

### 隐私FAQ、纯链接分享、收藏入口

用户连续追加3项，均已实施，仍在feat/product-redesign/PR3。首页7项隐私问答如实说明服务方可读取按名称空间、密码边界及链接/设备/副本/访问记录风险。工作区分享取消navigator.share的text/title拼接路径，直接复制纯URL；public readonly与private reader能力保持，先用系统复制拼接fixture证实旧实现失败，再验证纯链接可打开。首页与工作区新增收藏入口，显示浏览器快捷键/菜单指引及当前页纯链接复制，不伪报自动收藏；收藏空间明示完整链接与浏览器账号共享风险。typecheck、50测试、76浏览器场景、23Docker smoke通过。320px首页按钮已看图并修复折行；实际检查3210收藏及分享提示。旧镜像与before-privacy-share-bookmark-1793260937快照可用，原23/28/2记录摘要一致；随后新建独立合成空间。浏览器书签最终确认由用户操作，未实际添加用户书签；实体手机/其他浏览器/原生缩放/独立审计仍未验收。

## 当前迭代：浏览器密码保护（本地交付）

用户授权采纳建议：普通空间保留名称访问，设置新密码时浏览器加密，去掉服务方读取FAQ，准确强调HTTPS/加密存储。ADR-006冻结协议。backend owns server/tests、crypto owns password-protection helper/tests、acceptance owns Home/styles/visual及新保护验收，root owns App/shared/其他文档/配置/集成。新保护不上传原密码或正文key，服务器public_key=NULL，使用proof验证与全页CAS+keyRevision；旧门禁通过重新设置新密码升级，不强制修改现有数据。root已实现丢响应二次确认与旧密码草稿恢复。最终61单元/集成、旧76阅读、46链接、78parity、新75浏览器保护检查通过，typecheck/格式/静态门禁通过。已处理丢响应确认、跨设备改密/取消、旧密码草稿本地恢复、另一tab晚写稿不盲删、旧异步加密不覆盖新代际。当前分支feat/browser-password-protection。Docker已更新且健康，23基础smoke+8实际容器新保护检查通过；更新前快照和旧镜像before-browser-password-1793267608可用，原25/30/2业务列摘要一致，新列默认正确，无用户正文/密码强制转换。root看图与3210页面检查完成，独立演示privacy-tdd8oi可由用户自行设密码。旧密码空间需通过新版重新设置新密码升级；独立审计/实体设备/其他浏览器/HTTPS公网仍未验收。

### 开发镜像清理与最新保留规则

用户指出开发阶段不需要保留历史镜像。已删除10个无容器引用的2space:before-*标签；2space:local及当前开发镜像保留，数据卷、备份、其他项目未动，容器未重启且health ok。后续不再逐轮创建/积累历史镜像，按Git提交重建回退；数据备份单独处理。当前规则已写AGENTS/OPERATIONS，覆盖旧验收文档的镜像保留惯例。


## 2space.cn 首次生产交付（2026-10-30）

用户已明确授权在HWN-Singapore-01使用Docker、Nginx、SSLManager上线2space.cn，覆盖此前仅本地验收的历史授权范围。本次生产基线d8f7661加最小可信反代适配；新TRUSTED_PROXIES默认不信任转发头，仅部署时配置精确代理地址，3项先红后绿回归及全部33后端测试/typecheck/build通过。源代码和测试留在当前工作区，未提交/推送；不要只用HEAD代表生产制品。

生产容器hn-sgp-2space健康，127.0.0.1:3210，独立命名卷2space-production-data，非root/只读rootfs/512MiB/Secure Cookie。Nginx配置SSE非缓冲、4MiB请求上限及请求日志关闭。SSLManager已首次签发2space.cn、仅对该新证书启用源自动续期，独立凭据和既有6小时拉取timer接入；源active检测healthy。证书/配置备份与数据备份留在服务器受限目录，凭据不入项目。

实际容器23项smoke、公网HTTPS/资源/SSE、超过1MiB的6页保护转换、安全Cookie、错误proof拒绝、重启持久化与重新解锁全部通过，合成空间已清理。真实浏览器看过首页；既有tedxiong.ai和3x-ui保持正常。未清卷、未搬迁开发数据库；尚未观察自然换证、未做跨网实体手机/全浏览器/独立安全审计。详见[生产部署记录](docs/PRODUCTION-20261030.md)。

## 微信卡片准备（2026-10-30）

用户要求复用WeReadingNotes公众号并先准备、给出后台步骤。本地新增独立/wechat-share.html、双格Logo PNG、固定URL签名代理及验收脚本；WeReadingNotes仅新增对此精确页面签名的白名单/测试。共用现有票据服务，不复制AppSecret，不在首页/工作区加载微信脚本；卡片指向首页，不分享具体空间。保留本轮之前未提交的生产可信代理/部署资料。配置与部署清单见docs/WECHAT-SHARE.md；未部署/未推送/未改公众号，不能称真实卡片完成。类型/单元/签名及分享页模拟检查通过，完整visual结果见交付记录。

微信准备验证结果：35后端+31前端、WeReadingNotes6项、visual76组及独立分享页三视口模拟检查通过，已看分享页1280/390/320与首页截图。未运行真实微信SDK账号流程、未部署或修改生产容器，原生缩放/跨浏览器未验收。

用户随后提供公众号MP验证txt，已原样复制至apps/web/public/。本次conn-hub/VPSOps在线检查未通过、只读SSH40秒超时，尚未部署该文件，未改Nginx/容器。后台域名校验等待公网文件可用；详见WECHAT-SHARE末节。

更新：用户要求继续并重试后SSH恢复，使用~/.ssh/known_hosts既有信任成功。MP验证文件已上线，Nginx两协议精确alias，配置检查/平滑reload通过；公网HTTP/HTTPS200且原始字节一致，首页200/容器healthy。未部署分享页/签名功能。备份路径与细节见WECHAT-SHARE末节。

用户告知公众号后台已完成后，已上线两站微信分享增量。WeReadingNotes共用签名白名单构建/重启通过，2Space由原AMD64镜像叠加当前dist为2space:wechat-current，保留数据卷/可信代理/Cookie配置，更新前SQLite在线备份与compose在/root/maintenance-backups/2space-wechat-release-20261030T055337Z。公网分享页/封面/签名/验证txt与首页均200、容器healthy、integrity_check=ok。独立分享页为https://2space.cn/wechat-share.html，卡片去首页；真实手机微信卡片仍待用户测试，源码未提交/推送。详见WECHAT-SHARE末节。

## 开源准备（2026-11-15）

- 中英文 README 互链，共用从隔离实例截取的首页图。Compose 启动等待健康检查，CI 使用同一条命令并验证重启持久化。自托管文档补充 HTTPS、SSE、整空间重加密请求上限、备份及恢复。
- 用 HEAD 源码叠加本轮 Compose/忽略规则/CI 改动，隔离验证 Docker 启动与重启 24 项、短链兼容 46 项、空间权限及保留设置 78 项、密码保护 75 项、浏览器阅读与功能 76 组，均通过。原工作区类型检查和单元测试也通过。未运行公网 HTTPS 验收。
- 发布仍待确认许可证和版权主体，复核 Git 历史、运维记录及未跟踪的微信验证和发布素材，再确定公开源码范围。公开版若保留站点专用入口，应先确定如何处理品牌域名和微信签名服务。生产依赖审计报告 3 项中危，待更新静态文件插件及其依赖并复验。当前无公开发布或远端变更。

### 公开候选版隔离（2026-11-15）

- 更新 `@fastify/static` 到 10.1.11，锁定 `glob` 14.0.6 和 `minimatch` 11.0.8。全量与生产 npm 审计均返回 0 项；原工作区类型、单元、短链接、参考对照、密码保护、微信模拟验收通过。
- 公开候选源码在同级 `2Space-open-source-candidate`，基于已缓存的上游提交和本轮依赖及部署改动，以文件清单导出并建立单一根提交 `d326a5c`。微信签名、验证文件及发布素材见于本地 Codex 快照引用，普通分支与已缓存的远端引用未命中这些路径。历史内仍有内部项目记忆及部署记录。候选仓库没有远端，也未导入原历史。
- 候选容器健康、重启持久化及 24 项检查通过，微信接口与分享文件返回 404。候选界面用相对路径显示，分享仍按当前访问地址生成。原仓库与线上部署未迁移。许可证建议 MIT，待版权署名和许可证确认后加入。

## 2026-11-15 · 站点多语言

本地工作区已接入简体中文、英语、日语、法语、德语。默认按浏览器语言顺序匹配，手动选择存于当前站点，可恢复跟随浏览器。可切换首页、编辑器、分享页、浏览器 404 及应用提示，笔记正文保持原文。五份 README 已互链。纯本地验收使用临时数据库和合成数据。微信分享卡片以模拟 SDK 验证，真机微信待验收。本轮未发布。
