# API v1 与 v2 增量契约

> 当前增量基线：2026-10-29用户明确选择新建空间凭名称查看和修改、密码可选。新public默认永久，`?readonly`仅页面模式；旧private空间和旧链接保持原权限与加密边界。最新需求、API和验收范围见[JIANLA-PARITY.md](JIANLA-PARITY.md)，下文原私密模式设计仍适用于旧空间。

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

## v2 命名与短链接

新增接口、响应、HKDF编码与增量迁移的权威补充是 [SHORT-LINKS.md](SHORT-LINKS.md)。v1接口与旧能力链接继续受支持。现代POST分享与GET分享统一返回 `{share: CompactShareRecord|null}`，首次201，原子复用200。密文keyEnvelope解码为48字节，ownerEnvelope不超过1024字节。

## v3 浏览器密码保护（ADR-006）

新版客户端为public名称空间设置/更换密码时走本节，普通public和旧private能力链接继续兼容。旧public仅密码门禁不在启动迁移中自动转换；通过新界面重新设置密码时全量升级。

- `GET /api/spaces/:id/protection`：public可获取`{protection:descriptor|null,keyRevision}`，只公开KDF参数；private仍需原Bearer，不跳过原能力鉴权。
- descriptor固定`{version:1,kdf:"PBKDF2-SHA256",iterations:600000,salt:base64url16bytes}`。内容key与认证proof由浏览器PBKDF2+HKDF不同域派生；具体字节协议见ADR-006。原密码/root/内容key不进入新保护请求，proof仅用于认证，不可解正文。
- `POST /api/spaces/:id/protection`：输入shared.ChangeProtectionRequest，严格space/page/keyRevision CAS、全页重加密，一个事务替换。开启/更换传descriptor+proof，禁止publicKey；取消传null+fresh publicKey，禁止proof。成功给当前请求新cookie，撤销其他会话/SSE，返回SpaceView。
- SpaceView新增`keyRevision`与可选`protection`；保护期间没有publicKey。新加密代际要求POST/PUT pages附带对应`keyRevision`，旧代际写入409 `KEY_CHANGED`，不能静默污染新内容。
- `POST /unlock`新保护仅接收`{proof}`，旧门禁仍接收`{password}`，成功均204。任何经历过v3转换的public空间拒绝旧`/password`接口，409 `PROTECTION_REQUIRED`，防止取消后被旧客户端静默降级。
- 原子转换保持createdAt/updatedAt/expiresAt及排序，增加space/page revision与keyRevision，不将密码变化当正文编辑续期。新路由上限3,300,000字节容纳6页，其他请求上限不变。
- 新增422 `INVALID_PROTECTION`；任何验证/CAS/限速失败不允许部分转换。proof哈希和服务端盐不进入响应，KDF参数不接受降低次数或任意配置。

## 微信网站分享（2026-10-30 本地准备）

新增独立签名代理 `GET /api/wechat/jssdk?url=https%3A%2F%2F2space.cn%2Fwechat-share.html`。只接受该精确URL及单一url参数，其他输入400 INVALID_URL；共用WeReadingNotes签名服务，成功仅返回appId/timestamp/nonceStr/signature，上游失败502 WECHAT_UNAVAILABLE。不是空间API，不变更shared/数据契约或现有授权。详见WECHAT-SHARE.md；尚未部署。
