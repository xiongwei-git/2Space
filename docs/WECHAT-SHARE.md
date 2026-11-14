# 微信网站分享卡片：准备与公众号操作

日期：2026-10-30。状态：本地实现与模拟验证，尚未部署/公众号配置/微信真机验收。

## 方案与边界

复用 WeReadingNotes 所用公众号，前提是该账号有新版自定义分享权限、有可用 JS 接口安全域名名额，且后台接受 2space.cn。不重置 AppSecret，不覆盖原安全域名/IP 白名单。

共享签名由 WeReadingNotes 单实例服务维护 access_token/jsapi_ticket。2Space 的 GET /api/wechat/jssdk?url=... 仅接受精确 https://2space.cn/wechat-share.html，服务器请求固定 WeReadingNotes 签名地址，仅返回 appId/timestamp/nonceStr/signature；不转发 Cookie、Authorization、正文、空间地址、查询串或片段。不在2Space配置AppSecret。WeReadingNotes新增同一精确地址白名单，原来源规则保留。现有公众号如还有其他取票应用，应统一票据所有权，不能假定本方案已消除那些应用之间的刷新冲突。

分享页是独立HTML文档，使用现有tokens.css与双格Logo，正文16px、标题24px。仅这个精确页面CSP允许微信官方SDK；首页/编辑页没有SDK。点“打开2Space”完整导航到首页并销毁分享页脚本上下文。新页面无正文/密码/空间链接输入，不嵌入工作区。不会自动把具体空间、笔记或权限链接放进卡片。

卡片标题“2Space · 这边复制，那边就有。”；简介“一段文字、一份代码，随手放下，换台设备接着用。”；封面 /share-cover.png（由现有SVG双格Logo栅格化）；点击卡片进入 https://2space.cn/ 。用户需从独立分享页进行首次分享；首页再次转发/直接粘贴网址不保证相同自定义卡片。朋友圈由微信决定呈现方式，通常不展示简介，不能等同聊天卡片。

独立分享页会请求微信官方脚本，属于外部信任边界；其余页面保持原CSP。禁止以后把该模块导入SPA入口或在空间页开放第三方脚本。

## 公众号后台操作（用户）

1. 登录 https://mp.weixin.qq.com/ ，选择 WeReadingNotes 当前实际使用的同一个公众号。在“设置与开发 / 接口权限”查找自定义分享消息内容、分享到朋友圈等JS接口权限，确认 updateAppMessageShareData、updateTimelineShareData 可用。菜单名称以当前后台为准。没有权限时先处理账号认证/类型限制，不依赖旧接口兜底。
2. 打开“设置与开发 → 公众号设置（或账号设置）→ 功能设置 → JS接口安全域名 → 设置”。保留 wereadnotes.tedxiong.com 及其他仍在用的条目，新增 2space.cn（不带协议、路径、端口）。本次不配置 www，除非以后单独接入它。
3. 下载弹窗中的 MP_verify_*.txt 原文件，将文件交给维护者；它是公开域名验证文件，不是AppSecret。WeReadingNotes仓库已有一个验证文件，但未确认是否属于当前使用账号，不盲目复用。维护者部署到2space.cn网站根路径后，确认HTTPS 200、纯原文、无登录/SPA回退，再回后台完成保存和扫码确认。若后台提示备案、域名归属、名额等要求，以实际提示处理，不能承诺已有资格。
4. 保留公众号开发接口IP白名单中 WeReadingNotes 签名服务器的实际出口IP。本方案2Space不直接获取微信票据，所以不需要仅为2Space新增华纳云IP。不要重置AppSecret、开启“服务器配置”消息回调或修改业务域名/网页授权域名；本次网页分享不使用这些能力。如WeReadingNotes尚未配置有效公众号环境变量，则由管理员在其服务器本地安全填写，不在聊天传递。
5. 两个项目部署完成且签名HTTP 200后，用手机微信打开 https://2space.cn/wechat-share.html ，待“分享卡片已准备好”，点右上角“… → 转发给朋友”，核对收到的标题、封面、简介与首页跳转。iOS/Android分别验收；SDK设置成功只代表设置接口成功，不等于实际分享成功。

## 发布准备（维护者）

- 在2Space部署当前新增静态多页面构建、封面与签名代理；保留既有可信代理适配及生产数据，按OPERATIONS备份/回滚。Dockerfile直接复制web/dist，包含新HTML及资源；无需新依赖或密钥挂载。
- 在WeReadingNotes部署精确来源白名单增量；保留现有密钥文件和进程环境。只修改白名单/测试，不复制其密钥。
- 配置2space.cn根路径的公众号验证文件。现有Nginx将路径转发给应用，可由 apps/web/public/ 承载文件（文件可公开，但必须确认当前账号）。
- 检查封面和分享页200、CSP只有分享页允许微信脚本、签名200且响应无票据/密钥。WeReadingNotes未配置时2Space统一502，不暴露上游细节。签名服务故障会影响卡片准备，不影响2Space编辑。
- 本次仅准备本地文件，未提交/推送、未改变公网服务或公众号配置。暂不要把未上线的分享页当成可用入口。

## 验证

- npm run typecheck、npm test；WeReadingNotes执行 node --experimental-strip-types --test tests/wechat-jssdk.test.ts。
- npm run test:visual；node scripts/wechat-acceptance.mjs（需先build）。新增脚本验证1280/390/320px、16px正文/无溢出、axe、模拟微信SDK、完整导航销毁SDK及带查询串不加载SDK。
- 分享截图 output/design-acceptance/wechat-share-*.png，需实际看图。真实SDK权限/签名/手机卡片、生产发布、原生缩放/其他浏览器仍待验收。模拟测试不能证明这些真实条件已满足。

### 本轮实际结果

2026-10-30：typecheck、npm test（35后端+31前端）、WeReadingNotes 6项签名测试通过；完整test:visual 76组阅读/功能/axe检查通过；新增分享页脚本通过1280/390/320px与模拟SDK检查。已实际查看wechat-share-1280/390/320.png及桌面/手机首页截图，分享页中文、链接、Logo和窄屏换行未见裁切。页面静态构建已生成，未重启本地或生产容器。微信官方文档本次工具打开失败，公众号当前菜单/权限/域名资格仍以实际后台为准。

### 公众号验证文件接收

用户已提供Downloads中的MP_verify_AlUm3Z2EKx03wrrt.txt；已校验并按原始16字节复制至apps/web/public/，未来构建可直接承载。尝试通过conn-hub/VPSOps连接HWN-Singapore-01时检查未通过，直接只读SSH亦40秒超时，未执行远端写入或重载。公网对应路径尚未取得原始验证内容；公众号后台保存仍待文件部署完成。不要将本地复制视为上线。

### 验证文件已上线（2026-10-30 13:51 北京时间）

用户要求重试后SSH握手恢复；严格使用本机已有 ~/.ssh/known_hosts 信任记录连接成功，没有新增或绕过主机信任。文件已原样上传至 /var/www/2space-verification/MP_verify_AlUm3Z2EKx03wrrt.txt（16字节）。Nginx的2space.cn HTTP/HTTPS vhost分别新增精确location，纯文本alias到此文件；未发布分享页或签名接口代码，未重启应用。nginx -t和平滑reload通过，配置前件保存在 /root/maintenance-backups/2space-wechat-20261030T055056Z/2space.cn.conf。

公网HTTP与HTTPS文件均200、Content-Type text/plain、响应字节与用户原文件一致；首页200、容器running healthy。conn-hub本次SSH证据已record/consume通过。用户现在可以在公众号后台保存2space.cn的JS接口安全域名；后台保存结果和真实卡片仍未验收。

### 分享功能已部署（2026-10-30，北京时间）

用户完成公众号后台配置后，已将WeReadingNotes生产签名白名单增量构建并经宝塔重启，复用既有运行环境和公众号配置。生产构建成功、2Space固定页面签名200，仅公开四个必要字段；原站其他来源规则未改。该服务源文件/原dist备份在其服务器/root/maintenance-backups/weread-2space-signer-*，没有读取/复制AppSecret。

2Space将本地已验收的web/server dist传到HWN-Singapore-01，在现有AMD64生产镜像上叠加构建2space:wechat-current，依赖未变。Compose保留原端口、可信代理、Secure Cookie和2space-production-data，执行单服务更新。更新前在线SQLite备份与原compose保留在/root/maintenance-backups/2space-wechat-release-20261030T055337Z。容器/tmp为tmpfs，docker cp未能读取该备份，改用docker exec cat读取到受限宿主备份文件；未覆盖数据库。仅此次成功备份后才更新容器。

实际公网首页、/wechat-share.html、其3个构建资源、/share-cover.png、MP验证txt均200；2Space签名代理200且字段严格限定；首页CSP不允许微信脚本，分享页仅允许指定官方SDK。容器running healthy、SQLite integrity_check=ok。更新会使现有进程内密码会话失效，用户可能需要重新输入空间密码，已保存正文保留。公众号后台配置完成由用户告知，微信手机里的真实卡片显示和转发仍待用户验收，接口200不能替代真机结果。源码变更仍未提交/推送。
