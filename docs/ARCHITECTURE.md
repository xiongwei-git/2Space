# 2Space 1.0 架构

```mermaid
flowchart LR
  A[设备A浏览器<br/>轻量编辑器] -->|AES-GCM密文 + Bearer| API[Fastify API<br/>服务端读写鉴权]
  API --> DB[(SQLite 持久卷<br/>密文/令牌哈希/版本/时间)]
  API -->|SSE版本通知| B[设备B浏览器<br/>本地解密展示]
  B -->|鉴权后拉取密文| API
  A -.->|链接fragment:密钥与能力凭证| B
  API --> TTL[到期检查与后台清理]
```

## 信任边界

浏览器持有明文、正文密钥和访问凭证；API持有请求中的凭证，数据库只存其哈希。URL fragment不会随普通HTTP请求发给服务端，但浏览器历史/扩展/剪贴板可接触完整链接。页面no-referrer、不引入第三方脚本、设置CSP。
服务器仍可接触元数据，并且向浏览器分发应用脚本，因此不能承诺防恶意服务器替换客户端；本版主要保护数据库静态内容和不同权限之间的访问。

## 模块

| 模块          | 责任                                   | 不负责              |
| ------------- | -------------------------------------- | ------------------- |
| shared        | API类型、额度、生命周期常量            | 网络、数据库、UI    |
| web/crypto    | 生成密钥、AES-GCM、可选PBKDF2封装      | API存储明文         |
| web/editor    | Tiptap schema、粘贴净化、代码/复制     | 读写鉴权            |
| web/state     | 草稿、自动保存、CAS冲突、事件重连      | 将失败标为成功      |
| server/auth   | token哈希、owner/reader权限            | 根据URL参数决定权限 |
| server/store  | SQLite事务、revision、过期清理         | 解密或解析HTML      |
| server/events | 变更版本通知、撤销流清理               | 传输解密密钥        |
| Docker        | 同源静态/API、非root、持久卷、健康检查 | 公网TLS/DNS         |

## 生命周期

创建时生成随机正文密钥和ownerToken，客户端对首份笔记加密，API返回随机空间ID。后续每次保存使用新随机IV且expectedRevision与密文一起提交。服务端原子更新成功后通知；前端只在对应版本得到确认后标已保存。
接收页鉴权后拿到密文，用fragment密钥解密。SSE只通报revision；客户端再读取，防重连漏消息。若本地dirty或保存冲突，不用远端内容直接覆盖，提供保留本地与读取远端的选择。
分享token独立于owner，由owner请求创建/轮换。读者无法调用写入/创建分享/保留设置。撤销令牌无法撤回已看到内容。

## Docker拓扑

生产一个app容器，HTTP 3210映射127.0.0.1，SQLite放/data，named volume存储；容器无外部数据库。开发可用同一仓库源码挂载，Vite代理API保证浏览器同源。单实例模式；多实例前先升级事件总线与数据库。

## 并行协作

共享契约先冻结；T1/T2/T3以目录分工并行，负责人统一安装依赖、锁文件与集成。完成条件是代码+对应测试+差异说明；没有测试结果不能标完成。后续多开发者使用feature分支/worktree和PR，禁止交叉修改公共契约而无版本协调。
