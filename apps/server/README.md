# 2Space API

Fastify 5 + Node 24 `node:sqlite`。入口 `src/index.ts`，应用工厂 `buildApp` 支持内存库、假时钟和清理间隔，以便验证鉴权和到期。

- `npm run dev -w @2space/server`：默认127.0.0.1:3210。
- `npm run build -w @2space/server`：输出 `dist/index.js`。
- `npm run start -w @2space/server`：启动产物。
- `npm run test -w @2space/server`：API集成及SSE测试。

环境变量：`HOST`、`PORT`、`DB_PATH`、`WEB_DIST`。Docker内HOST=0.0.0.0由loopback映射限制宿主访问。静态默认同仓 `apps/web/dist`，构建前不存在时API仍可开发。

private数据库只存正文密文、随机空间/页ID、令牌SHA-256、版本和时间元数据；public模式按用户选择额外保存正文key，使凭名称且通过可选密码的用户可读写。API不记录请求。数据库WAL持久化，foreign_keys和secure_delete开启。到期请求立即拒绝并删除空间，后台30秒清理；读取不会续期。物理磁盘快照/备份不在此清除保证内。

SSE使用携带Bearer的fetch，不用查询参数鉴权。每连接15秒心跳，空间变更广播revision；撤销/轮换分享立刻关闭已有reader流。最多30个流/空间。程序关闭前先断开流，随后关闭SQLite。

API写入只支持JSON。全局600次/分钟/IP，创建20次/小时/IP；`trustProxy=false`，生产反代下需先设计可信代理IP范围，不应直接放开X-Forwarded-For。

扩容限制：单进程内SSE广播与限速、单SQLite库。1.0不声称多实例实时一致性。共享契约在根packages/shared及docs/API.md。

## 命名空间与短分享增量

命名规则及新协议见根 `docs/SHORT-LINKS.md`。启动时检查 `PRAGMA table_info(spaces)`，仅在缺列时添加nullable `name`，建立唯一索引及独立 `compact_shares` 表，不重建或覆盖原空间/正文/凭证。执行前由集成负责人备份运行数据库；本模块测试使用独立临时库，不接触生产3210。

名称仅定位，GET by-name仍需Bearer。旧空间可绑定一次名称，名称绑定本身不延长保留期；到期名字可用于新空间，但旧凭证不会因此获得新空间权限。

现代分享使用两份密文封装。API保存token哈希；对持有compact reader token的请求只返回keyEnvelope，对owner-only descriptor返回keyEnvelope和ownerEnvelope。create-or-get在SQLite IMMEDIATE事务内完成，重复请求返回同一descriptor，只有显式replace会轮换并清除旧v1读凭证。无body的v1 POST保持原响应与行为，不删除compact grant。撤销删除两类读权限，关闭现有reader SSE。

## v3 对照模式、密码与统计

默认仍是private，旧库增量列access_mode默认private，绝不转成public或暴露其正文key。仅创建时显式public且提供name/publicKey才开放名称读写；public不是端到端私密空间，服务端和获准访问者可读正文。名称允许1–64位字母数字下划线中划线，保留路由大小写不敏感拒绝。

public默认永久，private省略retention仍24h。永久数据库使用9999年哨兵、API返回expiresAt:null。设置保留期限从最后正文修改时间起算，不更新正文时间；选择过短期限可能立即过期，前端应确认。访问统计POST单独更新count/lastViewedAt，不续期；响应的viewerIp不保存为历史。排序提交全量ID，固定main_page_id第一且不可删除，排序不续期。

空间密码scrypt(N=32768,r=8,p=1)+16字节独立随机salt，不保存明文。密码设置/更改/清除关闭原连接并失效原会话；unlock验证错误按IP/空间20次/15分钟限速。密码会话仅进程内保存30分钟，private另绑定Bearer哈希，重启后重新解锁。cookie各空间独立、HttpOnly、SameSite=Strict、Path=/api/spaces，COOKIE_SECURE=true可启用Secure。lock支持仅cookie注销，供离页beacon使用；SSE每15秒检查有效会话，密码变化和主动lock即时关闭对应连接。

未记录IP访问历史；部署代理如要显示真实客户端地址，应先约定可信代理范围，不能直接信任任意转发头。新列/表仅增量迁移，不改旧正文、旧凭证或旧保留期。更新实际3210运行服务前仍须负责人备份并核对旧数据。
