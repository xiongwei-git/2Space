# 2space.cn 生产部署记录

日期：2026-10-30（Asia/Shanghai）。用户授权 Docker 部署、Nginx 反代，并通过 SSLManager 获取和定期更新证书。目标为 conn-hub 的 HWN-Singapore-01；公网入口 https://2space.cn/ 。

## 来源与运行

- 基线为当前干净工作区 Git d8f766163e543072cacf68a8d342f60bda748a24，包含浏览器密码保护；不是早期1.0根提交。
- 原开发镜像为 ARM64；已从当前源码构建 linux/amd64 生产镜像，未修改或重启本机开发容器、未复制开发数据库。
- 初始镜像 2space:deploy-d8f7661，压缩传输 91,475,984 字节，两端 SHA-256 均为 240aaa1aeaf66514aaea52504bf2036a62ad517da4c5344a9021a40e2b6685a8。
- 部署检查发现 Fastify trustProxy=false 使所有反代客户端共享创建/请求限流。新增 opt-in TRUSTED_PROXIES / AppOptions.trustedProxies，默认仍为 false；只配置明确的宿主 loopback 和 Docker 网关。
- 回归先证实旧行为对第二个真实客户端返回429；修复后3项可信代理/不信任默认值/防左侧地址伪造测试通过，全部33项后端测试、后端typecheck和build通过。
- 最终生产镜像 2space:deploy-d8f7661-proxy，在已校验AMD64镜像上仅叠加同工作区重新编译的server dist；前端不变。镜像摘要 sha256:f9c0681aa55d83a0209cf89ae722232149fc9fabc9d1624cdbfb580621187c95。
- 可信代理适配与测试已留在本地源码工作区，**本轮未提交或推送 Git**；不能用 Git HEAD 单独代表这个生产版本。完整Dockerfile用当前工作区也可重新构建，后续代码交付时需纳入这项适配。
- 远端项目 /srv/compose/2space，容器 hn-sgp-2space，仅 127.0.0.1:3210 映射，生产卷 2space-production-data，容器内 /data/2space.sqlite。原预留 /srv/compose/2space/data 目录不是活动数据库路径。
- 非root node用户、只读rootfs、cap_drop ALL、no-new-privileges、16MiB临时tmpfs、512MiB内存上限、256 PID上限、20秒停机宽限、unless-stopped、local日志5m×2。COOKIE_SECURE=true。

## HTTPS 与证书

- Nginx /etc/nginx/conf.d/2space.cn.conf：80跳转HTTPS；443反代原URI到127.0.0.1:3210，不改写SPA或API路径。4MiB请求上限，proxy_buffering/proxy_request_buffering关闭，SSE读超时1小时，关闭gzip防止流缓冲。
- 此域名vhost access/error请求日志关闭，应用logger=false；没有把空间能力链接、请求正文或测试凭据写入交付文档。
- SSLManager 原无该证书；已登记2space.cn，核对权威NS为阿里云，使用现有Aliyun provider，通过SSLManager完成首次 Let's Encrypt EC256签发；VPS没有为本域名配置ACME。
- 源策略仅新增本证书 renewal_owner=sslmanager / automatic_renewal_enabled=true，全局调度双开关已开启，其他4组策略核对未变。修改前受限 settings 副本保留在源data目录；未重置生命周期attempt/outbox，也未强制第二次签发。
- 用户单独确认后创建 HWN-Singapore 2space.cn 凭据，仅授权本证书，Token仅在远端 /etc/sslmanager-nginx/2space-cn.token（0600），不复用或扩大tedxiong.ai凭据。
- 完整链/私钥位于远端 /etc/nginx/certs/2space.cn/，目录0700、文件0600；未挂入应用容器。
- 使用已有安全拉取客户端，在 /etc/sslmanager-nginx/config.json 增加独立2space-cn组，继续使用 sslmanager-nginx-pull.timer。北京时间00/06/12/18:23，最多10分钟随机延时。
- 客户端预检查、真实部署及后续unchanged路径成功，systemd oneshot Result=success / ExecMainStatus=0。校验失败保留旧证书，成功经nginx -t、reload和真实TLS指纹核对后保存版本。
- 实际公网叶子SHA-256为 43f7d5bdd61b1f094281161386ac1b7c3986878fd3a32311df80e6dfcc16b726，与源一致。证书到期2027-01-27 16:55:31 UTC，即2027-01-28 00:55:31北京时间。源默认active实例定向探测为healthy。

## 实际验证

- 在生产容器内执行原localhost-only验收脚本，23项页面/资源/API/权限/加密/冲突检查通过，脚本自建合成空间已清理；未绕过该脚本的目标保护或用本地开发库替代。
- 独立公网HTTPS验证首页/JS/CSS；浏览器可显示原首页，截图仅本地output/deployment-2space-cn/site-live.png（Git忽略）。没有改视觉/CSS，也未将此部署检查称为全站可访问性验收。
- 公网SSE能即时收到初始事件和正文修改事件，证明Nginx没有缓存流。
- 自建合成public空间，完整6页转换请求超过1MiB，独立Node验收客户端按浏览器相同协议派生key/proof并AES-GCM往返验证通过；原密码/root/key未作为新保护参数上传。响应无publicKey，Secure Cookie有效；无会话读取被拒绝，错误proof被拒绝。
- 对本应用执行一次Compose restart，6页加密内容保留，进程内会话失效后可用正确proof重新解锁、独立解密内容一致。仅操作本应用，未重启主机或其他服务。
- 上述合成空间最终经自身管理权限删除，未清空生产卷或其他用户空间。SQLite integrity_check=ok。
- tedxiong.ai与现有受保护3x-ui入口HTTPS均200，两个业务容器healthy，系统失败服务0。
- 最后采样：1963MiB内存、可用约1277MiB，Swap1023MiB当时未用；根分区49G中约4.6G已用、约45G可用。一次采样不等于高峰容量验收。

## 维护、备份与边界

- 私有运行配置只在固定服务器；身份与SSH连接继续由conn-hub统一维护，不在项目复制连接凭据。
- /root/maintenance-backups/2space-20261030 保留Nginx/拉取配置前件、可信代理更新前Compose、SQLite在线备份。卷保持原样，不执行down -v、volume rm或全局prune。
- 首次上线使用独立新卷，没有迁移本地开发内容；现有本地开发数据与旧能力链接仍属于本地实例，不会自动变为公网链接。
- 版本更新前按OPERATIONS做备份；重建Docker网络后核对可信代理网关；不要直接把TRUSTED_PROXIES设为全网信任。
- 本次未新增数据自动备份或告警任务。源和客户端证书定时器已配置且手动执行通过，自然触发、未来不同叶子切换尚待观察。
- 未完成实体手机跨网、所有浏览器、原生缩放或独立安全审计；不承诺匿名内容绝对安全或全站WCAG合规。
