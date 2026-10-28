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
