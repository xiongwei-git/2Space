# 2Space

**这边复制，那边就有。** 一个轻量、私密可控的跨设备文本空间。

1.0 聚焦文本、富文本和代码：保留常用粘贴格式与代码缩进，自动保存、跨端更新、只读分享。图片列入二期，任意文件不在范围内。具体实现和验收状态见 [验收记录](docs/ACCEPTANCE.md)。

## 本地 Docker 运行

需要 Docker Engine / Docker Desktop 和 Docker Compose v2；本地无需另装 Node。

```sh
docker compose up --build -d
```

打开 [本地 2Space](http://localhost:3210)。只监听本机回环地址，不暴露到局域网或公网。本轮不配置 `2space.cn` 的 DNS、证书或线上服务。

```sh
docker compose ps
docker compose logs --tail=60 app
docker compose stop
```

数据库放在 `space-data` 命名卷，停止或重建容器会保留。不要使用 `down -v`：那会删除持久卷。详见 [运行与备份](docs/OPERATIONS.md)。

## Docker 开发

```sh
docker compose stop
docker compose -f compose.dev.yaml up --build
```

打开 [开发工作台](http://localhost:5173)。源码挂载进开发容器；启动时单次 `npm ci` 后同时运行 API watcher 与 Vite HMR。API 监听本地3210，前端通过代理同源访问；依赖与数据使用独立开发卷。开发与生产配置占用相同端口，按需只运行一套。

## 验证

有 Node 24 时可直接运行：

```sh
npm ci
npm run typecheck
npm test
npm run build
node scripts/acceptance.mjs
```

`acceptance.mjs` 需要本地生产工作台（含前端构建产物和 API）已启动，只使用它自己创建的合成空间，验证首页、JS/CSS资源、SPA深层入口，以及密文往返、权限、版本冲突、分享撤销并清理测试数据，不打印凭证。自动验收不替代真实浏览器中的粘贴、复制、二维码和跨设备检查。

仅通过 Docker 执行代码检查可在开发镜像就绪后运行：

```sh
docker compose -f compose.dev.yaml run --rm --no-deps app sh -c 'npm ci && npm run typecheck && npm test && npm run build'
```

请先停止开发容器，避免两个进程同时修改依赖卷。

## 隐私与权限边界

- 正文和标题在浏览器使用 AES-GCM 加密，API 保存密文；空间标识、时间、大小等元数据仍对服务端可见。
- 管理与只读凭证分离，服务端校验权限。密钥位于链接 fragment，HTTP 请求不发送该片段；不要将完整链接放到工单、日志或公共聊天。
- **持有完整链接的人可以获得相应权限。匿名管理链接或密钥丢失后无法通过服务端找回。** 请妥善保管浏览器中的空间入口。
- 撤销分享会阻止后续访问，无法擦除接收方已复制、下载或截图的内容。
- 临时保留到期后停止访问并清理活动数据库；备份需独立设置保留周期。不要把“活动数据已删除”理解为所有历史备份即时消失。
- 不加载粘贴内容中的远程图片，拒绝脚本和危险 HTML；1.0 不支持图片或文件传输。
- 浏览器、终端、供应链或服务器提供的前端脚本被攻破，仍可能泄露内容；这不是“绝对安全”承诺，也不是独立安全审计结论。
- 本地 HTTP 仅用于回环调试。未来公开部署必须使用可信 HTTPS，并单独评估滥用防护、容量、备份与服务政策。

## 并行开发规范

模块职责与检查门禁见 [开发规范](docs/DEVELOPMENT.md)、[API契约](docs/API.md) 和 [任务进度](docs/TASKS.md)。前端、服务端、Docker交付按目录隔离；架构负责人统一维护共享契约、锁文件和集成。不在子任务内并发安装依赖或覆盖其他任务修改。

## 架构与需求

- [1.0需求基线](docs/REQUIREMENTS.md)
- [开发架构](docs/ARCHITECTURE.md)
- [安全规范](docs/SECURITY.md)
- [架构决策](docs/decisions/001-local-encrypted-monolith.md)
