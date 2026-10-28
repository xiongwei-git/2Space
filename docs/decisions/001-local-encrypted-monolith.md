# ADR-001：本地Docker单体与浏览器正文加密

Status: Accepted
Date: 2026-10-29

目标是轻快、隐私和可并行开发。选择React/Tiptap按需编辑器、Fastify、Node24内置SQLite、SSE、npm workspace；一镜像一进程，持久卷保存SQLite。
正文浏览器AES-256-GCM随机IV；能力链接fragment带密钥和独立读写token。服务端存token哈希及正文密文，无法由数据库直接读正文。空间ID/时间/大小仍是可见元数据。HTTP本地仅loopback，上线必须TLS。
不选微服务/Redis/CRDT，减少部署和依赖；不选自写contenteditable，避免撤销/粘贴/选区复杂性。能力链接没有账户找回，泄露者可访问；被撤销者已取到的内容无法远程擦除。端到端密文不是完整独立安全审计结论。
