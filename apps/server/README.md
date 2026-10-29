# 2Space API

Fastify 5 + Node 24 `node:sqlite`。入口 `src/index.ts`，应用工厂 `buildApp` 支持内存库、假时钟和清理间隔，以便验证鉴权和到期。

- `npm run dev -w @2space/server`：默认127.0.0.1:3210。
- `npm run build -w @2space/server`：输出 `dist/index.js`。
- `npm run start -w @2space/server`：启动产物。
- `npm run test -w @2space/server`：API集成及SSE测试。

环境变量：`HOST`、`PORT`、`DB_PATH`、`WEB_DIST`。Docker内HOST=0.0.0.0由loopback映射限制宿主访问。静态默认同仓 `apps/web/dist`，构建前不存在时API仍可开发。

数据库只存密文、随机空间/页ID、令牌SHA-256、版本和时间元数据。正文和标题不应传明文；API不记录请求。数据库WAL持久化，foreign_keys和secure_delete开启。到期请求立即拒绝并删除空间，后台30秒清理；读取不会续期。物理磁盘快照/备份不在此清除保证内。

SSE使用携带Bearer的fetch，不用查询参数鉴权。每连接15秒心跳，空间变更广播revision；撤销/轮换分享立刻关闭已有reader流。最多30个流/空间。程序关闭前先断开流，随后关闭SQLite。

API写入只支持JSON。全局600次/分钟/IP，创建20次/小时/IP；`trustProxy=false`，生产反代下需先设计可信代理IP范围，不应直接放开X-Forwarded-For。

扩容限制：单进程内SSE广播与限速、单SQLite库。1.0不声称多实例实时一致性。共享契约在根packages/shared及docs/API.md。

## 命名空间与短分享增量

命名规则及新协议见根 `docs/SHORT-LINKS.md`。启动时检查 `PRAGMA table_info(spaces)`，仅在缺列时添加nullable `name`，建立唯一索引及独立 `compact_shares` 表，不重建或覆盖原空间/正文/凭证。执行前由集成负责人备份运行数据库；本模块测试使用独立临时库，不接触生产3210。

名称仅定位，GET by-name仍需Bearer。旧空间可绑定一次名称，名称绑定本身不延长保留期；到期名字可用于新空间，但旧凭证不会因此获得新空间权限。

现代分享使用两份密文封装。API保存token哈希；对持有compact reader token的请求只返回keyEnvelope，对owner-only descriptor返回keyEnvelope和ownerEnvelope。create-or-get在SQLite IMMEDIATE事务内完成，重复请求返回同一descriptor，只有显式replace会轮换并清除旧v1读凭证。无body的v1 POST保持原响应与行为，不删除compact grant。撤销删除两类读权限，关闭现有reader SSE。
