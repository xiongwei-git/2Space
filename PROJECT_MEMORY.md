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
