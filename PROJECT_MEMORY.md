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
last_reviewed: 2026-10-29
```

用户明确要求先在当前设备本地Docker开发和调试，因此当前由MacBook承载。未部署公网、未迁移Mac mini、未修改DNS；后续常驻服务归属再确认。

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
