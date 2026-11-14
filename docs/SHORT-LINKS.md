# Named spaces and one-click sharing · v2 additive contract

> 新建空间默认凭名称读取和编辑，可设置密码。旧版能力链接及其权限继续有效。

2026-10-29：用户要求空间先命名（默认随机/允许填写）、缩短链接、分享更直接。保留已验收UI、web-reading-v1、端到端加密和旧数据/链接；不部署公网。

## 用户流程

首页名称输入框预填随机8位小写字母数字，可自填3–32位小写字母/数字/中划线。创建成功进入 /name#o=CODE。名称不是密码，名称公开；禁止使用敏感信息。重名返回409，不自动获得原空间权限。单独访问/name展示输入访问码入口，不公开正文。保留原“创建我的空间”主动作，冲突时明确指引“打开已有空间”。

点击“分享空间”立即打开简洁分享面板、准备并复制只读链接，同时展示链接和二维码，不再要求先点生成。已有分享跨刷新/设备复用，重复分享不轮换。复制被浏览器拒绝时保留一键复制与手动选择，不虚报成功。高级设置折叠：密码链接、更新链接、撤销。更新明确旧链接失效。只读默认、管理链接为次级明确操作；分享整个空间的文案保留。

沿用docs/DEVELOPMENT.md的Type Scale：正文16px/1.75；控件、操作说明、关键提示14px/1.5–1.75；12px仅原白名单。不改字体Token，不回退用户刚调整的桌面高度/响应式。

## 加密与链接

新管理链接 /name#o=SEED：SEED为32随机字节base64url（43字符），HKDF-SHA256分别派生32字节正文key和32字节ownerToken，使用不同info域。
新只读链接 /name#r=SEED：SEED为16随机字节base64url（22字符，128bit随机访问能力），HKDF-SHA256分别派生32字节readerToken和32字节wrappingKey。正文仍AES-256-GCM，分享能力具有128bit穷举门槛；不是用户可猜测的短数字码。
所有HKDF固定salt UTF8 "2Space compact v2"；info分别UTF8 "owner/document", "owner/auth", "reader/wrap", "reader/auth"。seed长短和canonical编码严格验证。
owner创建分享时，用wrappingKey AES-GCM封装原正文key（原始32字节）为keyEnvelope；用正文key AES-GCM封装UTF8 JSON {"version":2,"seed":"..."}为ownerEnvelope。每个envelope独立随机12字节IV；keyEnvelope的ciphertext解码恰48字节，ownerEnvelope解码不超过1024字节。服务端只保存这两个密文和readerToken哈希；无法从数据库获得正文key或分享seed。
owner后续GET分享descriptor，用正文key解ownerEnvelope恢复同一分享seed。reader在本机derive auth token，先鉴权取密文/keyEnvelope再unwrap正文key。seed/key不发送服务端或写日志/查询参数。
参考正式域名：8位name时，只读链接约43字符（不含协议），管理约64字符；实际本地地址较长。不能通过明文短链映射上传密钥。旧独立key+token链接不强行转换新owner seed，也不重加密旧正文。

## API增量（冻结）

- POST /api/spaces：可选name；无name保持v1行为兼容。新建name为空/非法422，重名409 NAME_TAKEN；保留字不可用。
- SpaceView额外可选 name、readerKey。readerKey仅当使用compact reader token鉴权时返回keyEnvelope。
- GET /api/spaces/by-name/:name：Bearer鉴权后返回SpaceView；使用相同权限/到期/限速策略，不能根据name直接读取。
- PATCH /api/spaces/:id：可选name、retentionSeconds，至少1字段。仅owner可首次绑定name；绑定后不可变（同名幂等，其他409 NAME_LOCKED），避免静默使历史链接失效。仅绑定名称不续期/不改正文；revision可递增通知。
- GET /api/spaces/:id/shares：仅owner，200 {share: CompactShareRecord|null}。
- POST /api/spaces/:id/shares：现代body {token,keyEnvelope,ownerEnvelope,replace?:false}；返回{share: CompactShareRecord}，与GET同结构。无compact分享时201创建；已有且replace不是true时200返回现有descriptor（原子create-or-get），不能轮换令牌。replace:true明确替换并清v1 reader_hash，旧所有读者SSE关闭。分享创建/读取不续期。
- v1无body POST分享仍返回201 {token}，保留兼容；只轮换v1 reader，不能意外删compact分享。
- DELETE /api/spaces/:id/shares：撤销v1+compact分享，关闭全部reader SSE。
- 所有既有UUID CRUD/SSE路由继续使用SpaceView.id；name仅增加用户入口。

## 数据迁移

spaces增加nullable name，唯一索引。独立compact_shares表(space_id PK FK cascade,token_hash,key_iv,key_ciphertext,owner_iv,owner_ciphertext)，兼容已有reader_hash；不覆写旧key/token/正文。过期/删除cascade同时清理。
鉴权/SSE保活须承认v1 reader_hash或compact token_hash；现代分享reader读取只给当前有效keyEnvelope。旧owner缺name时前端首次分享以随机name绑定后创建compact grant，不轮换owner凭证；旧owner链接继续有效。
仅namespace映射可见名称，无任何公开密钥映射。已有SQLite通过schema检查执行幂等增量迁移，不能drop/recreate旧表。部署前备份当前本地数据库，禁止清卷。

## 密码与兼容

已有v1 password link解锁继续工作。现代分享高级密码操作可复用v1包装URL：相同compact reader token +原正文key在浏览器PBKDF2封装，链接可能较长，明确这是额外保护的可选模式。默认短只读不加密码。启用密码不能静默改变现有默认短链接权限；若想替换所有旧链接，需明确“更新链接”操作。

## 验收

名称合法/冲突/保留字/越权/过期复用；HKDF域隔离和错误seed/篡改拒绝；同分享跨请求/刷新复用；并发create-or-get；更换/撤销关闭旧流；旧v1普通/密码链接及数据库迁移保留；无需生成二次按钮的一步复制/二维码；320/390/desktop计算样式/axe/截图，访问不续期，已有草稿与用户UI不回退。
