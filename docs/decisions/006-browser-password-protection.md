# ADR-006：名称空间的浏览器密码加密

状态：用户授权实施，2026-10-29。基线bf79c38。

普通public名称空间继续凭名称读写；通过新版界面设置/更换密码时，浏览器派生内容加密钥匙及独立认证proof，服务器不保存正文解密钥匙。移除首页“服务提供方能读取”问答，不增加当前实现不具备的保证。HTTPS文案仅在实际HTTPS访问显示，本地不展示部署提示；内容加密存储保持准确，不伪称加密在服务器完成。

## 固定契约

shared新增BrowserPasswordProtection={version:1,kdf:'PBKDF2-SHA256',iterations:600000,salt:base64url16bytes}、ProtectionChallenge及ChangeProtectionRequest。SpaceView新增可选protection、keyRevision，旧响应缺省代际为0。

浏览器PBKDF2-SHA256(password,salt,600000)导出32字节root，再HKDF-SHA256派生两个独立32字节结果。HKDF salt为UTF8(spaceId)，info分别为UTF8('2space/password/v1/document')及UTF8('2space/password/v1/auth')。前者为AES-256-GCM正文钥匙，后者为proof。root/密码/documentKey不上传，proof不可用作documentKey。盐随机16字节；现有encryptDocument保留随机12字节IV。参数必须严格校验，不能接受任意迭代次数造成降级或计算DoS。只使用Web Crypto既有算法，不自创加密。

GET /api/spaces/:id/protection -> {protection:descriptor|null,keyRevision:number}。public仅公开KDF参数，不公开内容、认证hash或正文钥匙；private需要原Bearer且只返回null。过期拒绝。

POST /api/spaces/:id/protection（public owner + 当前密码会话）输入ChangeProtectionRequest。一次事务校验expectedRevision、expectedKeyRevision、全部页ID及每页expectedRevision，禁止缺页/重复页/混入旧payload。设置/更换时protection非null且proof为base64url32bytes，禁止publicKey；移除时protection=null且fresh publicKey必填，禁止proof。整个空间全部页重新加密，更新各页revision+1、space revision+1、keyRevision+1；保留页面顺序、创建/修改时间和expiresAt，不将加密转换当作正文编辑续期。事务失败不改变任何字段。

设置后public_key置NULL，服务器只存descriptor与scrypt(proof,独立随机服务端salt)；移除后恢复fresh public_key并清proof。清除旧会话、关闭旧SSE，给当前请求发新会话并返回SpaceView。完整6页有效负载上限要求此路由bodyLimit=3_300_000，其余路由上限保持。普通空间与所有private旧协议保持兼容。

POST /unlock：legacy继续{password} ->204，v3仅接受{proof} ->204；原密码绝不上送v3。POST /password禁止修改已是v3的空间，防止旧客户端绕过重加密降级；legacy接口保留用于既有客户端与测试，旧public密码空间在用户通过新界面设置新密码时升级，不声称已有历史数据/备份已追溯迁移。

POST /pages和PUT /pages/:id新增可选keyRevision；space keyRevision>0时必须相等，否则409 KEY_CHANGED，不接受旧客户端在新钥匙下写回旧密文。代际0仍接受省略。protection输入代际严格匹配；服务端不尝试解密。

## 客户端与兼容

设置/变更前等待正在保存的内容，解决冲突后才进行整页原子转换。取最新SpaceView，解开服务端当前正文后重新加密；无法解密、离线或CAS冲突必须停止，不得静默覆盖。清理本机已提交的草稿、使用新Access钥匙和keyRevision；不得将密码、root或钥匙持久化到浏览器。

v3新设备只用名称定位，输入密码后派生proof与正文钥匙；POST unlock成功再读取内容。已有cookie不能替代浏览器解密信息；页面刷新/新设备需要重新输入密码。旧private链接与整个空间密码门禁保持原行为。

密码变化或KEY_CHANGED时暂停旧代际写入并重新验证；本页未保存内容保留并支持重新加密为当前代际，不得静默丢草稿。变更界面明确提醒其他设备先保存未提交内容。旧密码空间不在无用户解锁的部署迁移中强制改写。

取消密码前明确告知恢复凭名称访问。忘记新密码不能由服务器恢复内容。旧备份、用户副本、浏览器恶意脚本与弱密码猜测风险仍存在，不作绝对安全或抵御恶意前端承诺。
