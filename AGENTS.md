# 2Space execution rules

- 中文优先。1.0仅文本、轻量富文本和代码；图片二期，任意文件不做。
- 用户已授权并行实施、本地Docker验收及在指定GitHub仓库维护代码；未授权公网部署或改域名。
- 先读 docs/DEVELOPMENT.md、docs/API.md。冻结 shared 契约；变更先告知架构负责人。
- 每个任务只编辑分配目录，不能覆盖其他任务改动。根配置和lockfile由架构负责人维护。
- 安全是产品要求：正文浏览器AES-GCM加密；密钥/令牌不得进入日志、查询参数、仓库或分析。
- 只读权限在服务端执行。禁止远端图片、脚本、iframe、内联事件和不安全链接进入富文本。
- 不宣称绝对安全。匿名管理凭证丢失不可恢复，链接持有人拥有相应访问权。
- 必须验证权限、冲突、过期、富文本清理、加密往返。共享规范与验收进度记docs/TASKS.md。
- 禁止提交真实凭证、运行数据库、研究中复制的第三方脚本、测试会话或完整能力链接。

## Web阅读验收

- 采用共享 `web-reading-v1`（`~/CodeX/my-agent-shared-memory/codex/web-design-baseline.md`）；先读共享基线和frontend-design，具体角色、元信息清单、命令及验收边界见 `docs/DEVELOPMENT.md`。
- 字阶由 `apps/web/src/tokens.css` 单点维护，正文16px、控件/次要正文14px、明确元信息12px。写CSS前输出或引用字阶表；不得通过手机断点或muted覆盖降低底线。
- 视觉修改必须运行 `npm run test:visual` 并实际查看 `output/design-acceptance/` 截图；同时核对功能回归。失败先修复，截图生成不等于人工审查或全站WCAG合规。
