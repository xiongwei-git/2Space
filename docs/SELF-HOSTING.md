# 2Space 自托管 / Self-hosting

[English](#english)

## 中文

在仓库根目录运行 `docker compose up --build --detach --wait --wait-timeout 90`。服务默认绑定在宿主机 `127.0.0.1:3210`。查看状态用 `docker compose ps`，健康接口是 `/api/health`。

跨设备访问时，给域名配置可信证书，并在 Docker 宿主机使用已有 HTTPS 反代，转发到 `http://127.0.0.1:3210`。应用使用浏览器 Web Crypto，需要 HTTPS 或本机环回地址提供安全上下文。可在 Compose 项目目录的本地 `.env` 设置 `COOKIE_SECURE=true`，重跑启动命令，使密码会话 cookie 只经 HTTPS 发送。此时用 HTTPS 地址操作剪贴板。

反代须支持 SSE，关闭响应缓冲、允许流连接长时间保持，并把请求体上限设为至少 4 MiB，以支持整空间重加密。保留原始访问域名，避免把空间路径、查询参数和请求头收集到代理日志或分析系统。直接部署在根路径，例如 `https://clipboard.example.com/`。更换宿主机端口时，反代上游也应使用新端口。

备份时，先运行 `docker compose stop app`，再用 `docker compose ps -aq app` 获取容器 ID。执行 `docker cp <container-id>:/data/. <private-backup-directory>` 将整个数据目录复制至私有备份目录，然后用 `docker compose start app` 恢复服务。备份中包含敏感数据，包括普通空间的正文密钥。恢复时先保留现用数据的副本，在独立卷验证恢复结果。

## English

Run `docker compose up --build --detach --wait --wait-timeout 90` in the repository root. The app binds to `127.0.0.1:3210` on the host by default. Run `docker compose ps` for status or request `/api/health`.

For access from other devices, use a domain with a trusted TLS certificate and an HTTPS reverse proxy on the Docker host. Forward requests to `http://127.0.0.1:3210`. The browser uses Web Crypto, which requires a secure context such as HTTPS or loopback. Set `COOKIE_SECURE=true` in a local `.env` file alongside the Compose file and rerun the startup command to require HTTPS for password session cookies. Use the HTTPS address when working with the clipboard.

Support long-lived server-sent event streams and disable response buffering. Allow a request body of at least 4 MiB for operations that re-encrypt an entire space. Preserve the original hostname and keep space paths, query strings, and headers out of proxy logs and analytics. Serve the app at the root of its origin, for example `https://clipboard.example.com/`. If you change the published port, update the upstream address to match.

To back up, run `docker compose stop app` and get the stopped container ID with `docker compose ps -aq app`. Copy the entire data directory to a private backup location with `docker cp <container-id>:/data/. <private-backup-directory>`, then run `docker compose start app`. The backup contains sensitive data, including ordinary spaces' content keys. Before restoring, preserve the current data and verify the backup in a separate volume.
