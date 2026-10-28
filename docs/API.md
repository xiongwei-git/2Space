# API v1（冻结契约）

权威类型：packages/shared/src/index.ts。JSON输入只接受契约字段并校验类型/上限。
Bearer使用32字节随机值base64url；服务端仅保存哈希。创建空间由客户端生成ownerToken；服务端生成spaceId。
EncryptedPayload.iv/ciphertext统一base64url无padding，必须canonical，IV解码12字节，ciphertext解码16–400000字节。
所有资源路由先鉴权。读者只能GET。SSE使用fetch流携带Authorization，不把令牌放查询串。
页面标题、HTML、plain text、代码语言均放在AES-GCM密文内；服务端不知道正文与标题。
时间用ISO8601 UTC。页面id由浏览器crypto.randomUUID产生，页revision从1递增。空间revision任何修改递增。
PUT采用expectedRevision并原子比较更新，冲突409不得自动覆盖。空间限6页，至少留1页。页面顺序按创建顺序。
保留默认86400秒，允许RETENTION_SECONDS；写入正文、新建/删除页会续期，读取不续期。到期GET返回404且后台清理。
错误结构及完整路由见shared注释；未知异常不得暴露堆栈。静态页面no-store、noindex、无第三方请求。
前端能力链接 /s/:id#k=<base64url AES key>&m=<owner token> 或 &r=<reader token>；片段不发HTTP服务端。不要在日志/文档保存真实链接。
分享重新生成token替换旧reader；撤销后既有SSE关闭/失效。已经下载或看到的内容不能撤回。
密码为链接本机解锁封装：PBKDF2-SHA256派生密钥封装AES key，fragment用w/s/i替代k；解锁在浏览器，不上传密码。可在前端后续独立实现，不改变API。
