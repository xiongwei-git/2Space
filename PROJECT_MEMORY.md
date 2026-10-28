# 2Space · 项目接续

```yaml
home: macbook
category: personal-durable
runtime: macbook
repository_model: single-repo
source_of_truth: github-origin
git_platform: github
git_visibility: unverified
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

不提交密码/令牌/密钥/完整能力链接/运行数据库/测试会话。不改Shared Memory。用户本轮指定仓库维护代码，不扩大为公网服务发布、DNS/TLS配置或其他服务器变更。
