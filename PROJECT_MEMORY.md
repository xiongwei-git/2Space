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
