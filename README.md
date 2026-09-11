# Node2Link 订阅管理

这是一个以 Cloudflare Pages Git 集成为主要部署方式的节点与订阅汇聚工具。管理端使用账号密码登录，不再使用 `域名/token` 或 `?token=` 进入管理页；`TOKEN` 只作为主订阅入口，确保已有设备无需修改订阅地址。

模块划分、KV 一致性边界及新版存储的回滚说明见 [架构与存储](ARCHITECTURE.md)。现有 Pages Git 自动部署方式和环境变量不变，无需新增绑定。

**v3 存储升级需要重新录入数据：** 本版移除了旧主订阅、设置、分享和 API 节点的兼容扫描，不自动迁移。旧 KV 记录不会删除，但不再显示；请先备份，再部署并重新添加。固定身份、已保存的 API 模板/Token、请求日志继续直接使用。

## 功能

- 账号密码登录管理端，会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`；
- 汇聚多个节点或上游订阅，并输出 Base64、Clash、Sing-box、Surge、QuanX、Loon 等格式；
- 独立设置页，可分别修改主订阅名称、浏览器标签页标题与图标、主订阅入口 Token，并在默认/自建转换服务和默认/自建规则之间切换；转换后端严格按设置二选一，不会在自建模式下回退到默认服务；还可增减及排序“我的订阅”所展示的客户端格式，各设置模块均可独立保存，标签页标题默认使用 `CF-Workers-SUB`；
- “仪表盘”“主订阅”“分享管理”和“订阅请求”使用顶部 Tab 切换，访问根路径时默认展示主订阅；启用可选的 API 订阅功能后会增加“API 订阅”Tab；
- 个人仪表盘展示本地节点及协议分布、上游来源数量、分享状态、未来 7 天到期提醒和最近修改；各模块支持折叠并在当前浏览器记住状态；
- API 订阅默认关闭；设置 `API_SUBSCRIPTION_ENABLED=true` 后，可先配置节点及名称模板，再由外部系统通过带唯一 Token 的 URL 一次追加多个域名/IP 地址或完整节点链接；节点只在 API 订阅页维护，但会动态附加到主订阅结果末尾；
- 设置按钮附近显示按北京时间生成的构建版本，便于确认线上部署是否已经更新；
- 独立分享管理页，可为不同节点组生成不同订阅链接，并支持重复创建、修改、重置链接和删除；分享内容既可手动输入节点和 HTTP/HTTPS 上游订阅链接，也可从主订阅与 API 订阅节点中勾选；分享订阅会动态拉取并合并上游内容，并与主订阅使用相同的客户端自适应转换逻辑；
- 主订阅与分享订阅统一使用 `/s/<随机ID>`，管理密码不会出现在订阅地址中；
- 节点检查、去重、草稿、备份与最近一次版本恢复；
- 主订阅保存会检查编辑版本：检测到其他页面已更新时保留当前编辑并提示，避免直接覆盖；主动清空后不再回退到默认上游，API 节点附加规则保持不变；
- 分享支持暂停、恢复和可选到期时间；已有分享默认长期有效，到期后可修改时间或清空期限继续使用原链接；
- 独立的订阅请求统计页，记录保留 30 天并聚合最近 500 条，主订阅与当前仍存在的分享订阅分别展示；
- 多个 Subconverter 后端自动回退。

## 部署前配置

必须绑定变量名为 `KV` 的 Cloudflare KV 命名空间。登录、设置、分享管理和主节点保存都依赖该绑定。

至少设置以下环境变量：

| 变量名 | 必填 | 示例 | 说明 |
|---|---:|---|---|
| `ADMIN_PASSWORD` | 是 | `使用强随机密码` | 管理员登录密码；未配置时登录会被禁用 |
| `ADMIN_USERNAME` | 否 | `admin` | 管理员用户名，默认 `admin` |
| `SESSION_SECRET` | 建议 | `独立强随机字符串` | 会话签名密钥；未配置时使用 `ADMIN_PASSWORD`，修改后所有会话失效 |
| `TOKEN` | 否 | `auto` | 初始主订阅入口 Token，同时提供 `/auto` 与 `/?token=auto` 两种主订阅地址，不授予管理权限 |
| `LINK` | 否 | `vless://...` | 未绑定 KV 时的只读节点来源；正式使用建议绑定 KV |
| `SUBNAME` | 否 | `Node2Link` | 初始主订阅名称；仅用于主订阅标题及下载文件名，分享订阅使用各自的分享名称，绑定 KV 后可在“设置”中修改 |
| `SUBAPI` | 否 | `sub.example.com,backup.example.com` | 默认转换后端，多个地址用逗号、分号或换行分隔 |
| `SUBCONFIG` | 否 | `https://.../config.ini` | 默认 Subconverter 规则配置；绑定 KV 后可在“设置”中切换为自建规则 |
| `SUBUPTIME` | 否 | `6` | 客户端订阅更新间隔（小时） |
| `API_SUBSCRIPTION_ENABLED` | 否 | `false` | 仅设置为 `true` 时启用 API 订阅 Tab、页面、接口、主订阅节点附加及分享选择器中的 API 节点来源；默认完全关闭 |
| `REQUESTLOG` | 否 | `sample` | 未设置时默认采样；`1`/`full` 完整记录，`0`/`off` 关闭；管理页保存的记录模式优先 |
| `REQUESTLOG_SAMPLE_RATE` | 否 | `0.1` | 正常请求采样概率，默认 10%；失败响应始终记录（关闭模式除外）；可在管理页设置 |
| `TGTOKEN` | 否 | `123:abc` | Telegram Bot Token |
| `TGID` | 否 | `123456` | Telegram 接收账号或群组 ID |
| `WARP` | 否 | `vless://...` | 附加到主订阅的 WARP 节点 |

请求记录可在“设置 → 请求记录”中选择采样、完整或关闭。未显式配置的部署升级后默认采样；已有 `REQUESTLOG=1` 或 `0` 继续生效，除非在管理页保存新模式。采样只减少新日志写入，不删除旧记录；页面数量为留存记录条数，不是总访问量或失败率。

旧版 `GUEST`、`GUESTTOKEN` 已不再使用，可以删除。`TOKEN` 默认作为主订阅入口；登录后可在“设置 → 主订阅入口”中手动修改或随机生成新 Token。设置为 `TOKEN` 后，`/TOKEN` 与 `/?token=TOKEN` 均可订阅；留空则停用这两种 Token 入口，但系统生成的 `/s/<随机ID>` 主订阅链接仍然有效。

页面随机生成的主订阅 Token 与新建分享的随机 ID 均为 32 位 Base64URL 字符串。v3 不自动读取旧分享，重新创建后需更新客户端链接；环境变量 TOKEN 入口保持可用，页面保存的 Token 需重新配置。

`SESSION_SECRET` 只用于给登录会话 Cookie 签名，防止别人伪造登录状态。它不会参与节点加密，也不会改变主订阅或分享订阅地址；可以使用密码生成器创建一段独立的强随机字符串。不设置时系统会退回使用 `ADMIN_PASSWORD`。

获取订阅的 Telegram 通知会显示具体的主订阅名称或分享名称。

### Pages

在 Pages 项目的“设置 → 绑定”中添加 KV 命名空间，变量名必须是 `KV`；然后在“变量和机密”中添加 `ADMIN_PASSWORD`、`SESSION_SECRET`。

Git 集成的构建配置使用：

```text
Build command: npm run pages:build
Build output directory: dist
Root directory: 留空
```

完整的一次性升级、自动部署、验证和回滚步骤见 [Cloudflare Pages 部署与升级手册](DEPLOY.md)。

项目会将模块化 Worker 源码打包到 `dist/_worker.js`，公共 CSS、精简后的 Lucide 图标和 QRCode 放在 `dist/assets`。静态资源绕过 Worker 并由 Pages 缓存；管理页面、API 和订阅响应继续禁止缓存。

分享列表使用当前记录 metadata 中的摘要，点击“修改”时才按 ID 读取完整节点内容；普通订阅不扫描设置、主订阅或分享修改历史。请求统计单次最多扫描最近 500 条事件。管理页面响应包含 `Server-Timing`，可在浏览器开发者工具中查看 Worker 总处理时间。

开发验证可运行 `npm run pages:build`。安装浏览器（`npx playwright install chromium`）后，运行 `npm run test:e2e` 检查桌面和手机交互；`npm run benchmark` 查看本地 KV 读取次数。浏览器测试由 GitHub Actions 单独执行，不改变 Pages 的构建命令。

## 使用方式

1. 打开部署域名根路径，例如 `https://sub.example.com/`；
2. 使用 `ADMIN_USERNAME`（默认 `admin`）和 `ADMIN_PASSWORD` 登录；
3. 在“主订阅”Tab 保存汇聚节点与上游订阅，右侧复制“我的订阅”链接；
4. 如需 API 订阅，先配置 `API_SUBSCRIPTION_ENABLED=true`，再在“API 订阅”中保存节点模板、名称格式与页面自动生成的唯一 API Token；未启用时该 Tab 和相关接口均不存在；
5. 在“设置”中分别保存基本显示、主订阅入口或转换配置；修改一个模块不会覆盖其他模块；
6. 在“分享管理”中填写分享名称，按行输入节点或 HTTP/HTTPS 上游订阅链接，也可点击“从已有节点选择”；选择器会汇总主订阅中的直连节点、可解析的上游订阅节点，并在 API 订阅启用时加入其生成节点，保存后即可复制独立订阅链接；
7. 在“订阅请求”中分别查看主订阅及当前分享订阅近 30 天的请求记录；已删除分享不再展示；
8. 分享内容修改后原链接保持不变；删除后该链接失效（Cloudflare KV 跨区域同步可能有短暂延迟）。

分享表单的“到期时间”按浏览器本地时间填写，留空代表长期有效。列表提供暂停/恢复按钮；暂停或到期的链接返回 410，管理页仍可编辑、续期或删除。恢复暂停不会清除到期时间。限制只影响后续获取订阅，不能撤回客户端已经下载的节点。

日期输入框采用紧凑宽度，支持的浏览器中点击日期区域即可打开原生选择器；点击“清除”恢复为空，保存修改后生效。不支持程序打开选择器的浏览器仍可使用原生图标或键盘输入。

登录后从顶部“仪表盘”进入 `/dashboard`。节点数量按已保存的主订阅与 API 节点内容合并去重，不含上游远程节点和分享副本，不表示节点在线率；上游来源数量只统计主订阅内保存的链接。到期提醒包含暂停的分享，最多列出最近 8 项；最近修改展示主订阅、现存分享和 API 节点的最新时间，并非完整操作日志。页面按需加载，可点击“刷新概览”更新，不轮询、不拉取上游、不新增部署绑定。

遇到主订阅编辑冲突时，当前文本和本地草稿会保留。先点击“备份”下载当前编辑，再刷新读取最新内容并合并修改。此检查基于 KV 当前可见版本，适用于个人多标签页操作，不提供跨地区同时提交的事务锁。

分享中的上游订阅支持明文节点、Base64 节点，以及 Clash/Mihomo YAML 和 Sing-box JSON。结构化的专属格式会交给当前选择的转换后端处理；默认 Subconverter 可转换为 v2rayN 使用的节点订阅，自建 Sublink Worker 的 `/xray` 仅聚合原始节点或通用 Base64 订阅，因此使用自建服务时应填写提供商的原始节点、通用 Base64 或 Servers-only 链接。v2rayN 获取 Base64 订阅时，项目会为只有 `peer` 的 AnyTLS 节点补充同值 `sni`，并过滤当前 v2rayN 无法解析的 `obfs-local;obfs=tls` Shadowsocks 节点；Clash/Mihomo、Sing-box 和其他客户端的结果保持原样。上游订阅和转换请求均设有 8 秒超时；不可达或限制 Cloudflare 访问的提供商会被跳过，避免拖到客户端连接超时。

### API 订阅调用

节点模板每行一个，必须包含地址、端口和名称占位符。例如：

```text
vless://uuid@{{address}}:{{port}}?encryption=none&security=tls#{{name}}
```

名称格式必须包含 `{{address}}`，例如 `CF-{{type}}-{{address|split:.:0}}:{{port}}`。可使用的占位符如下：

| 占位符 | 内容 |
|---|---|
| `{{address}}` | 名称格式中表示原始地址；节点模板中可直接放入地址位置，IPv6 会自动加方括号 |
| `{{port}}` | 外部调用传入的端口 |
| `{{name}}` | URL 编码后的节点名称，适合放在 `#` 后 |
| `{{type}}` | `域名` 或 `IP` |

占位符后可使用以下名称处理操作：

| 操作 | 示例 | 结果 |
|---|---|---|
| `slice:开始:结束` | `{{address|slice:0:6}}` | `cfsaas.080112.xyz` 得到 `cfsaas` |
| `split:分隔符:序号` | `{{address|split:.:0}}` | 按 `.` 分段后取第 1 段，得到 `cfsaas` |

外部调用使用 `address` 参数，它同时支持域名、IPv4 和 IPv6。单个地址的调用方式保持不变；批量导入时可在 GET URL 中重复传入 `address`。`port` 只有一个时会应用到全部地址，重复传入时必须与地址一一对应；省略时会为每个地址从 Cloudflare 标准 HTTPS 端口 `443`、`2053`、`2083`、`2087`、`2096`、`8443` 中随机选择。系统只保存一个有效 API Token：

```text
https://sub.example.com/api/import?token=<API_TOKEN>&address=cdn.example.com&port=443
https://sub.example.com/api/import?token=<API_TOKEN>&address=1.1.1.1
https://sub.example.com/api/import?token=<API_TOKEN>&address=cdn.example.com&port=443&address=1.1.1.1&port=2053
```

批量地址也可以使用 `POST application/json`。`addresses` 可传字符串数组（配合一个公共 `port`），也可传各自带端口的对象数组：

```bash
curl -X POST "https://sub.example.com/api/import" \
  -H "X-API-Token: <API_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{"addresses":[{"address":"cdn.example.com","port":443},{"address":"1.1.1.1","port":2053}]}'
```

完整节点可通过 `POST text/plain` 上传。请求正文可原样填写 `vless://...`，无需 URL 编码；Token 通过 `X-API-Token` 请求头传入：

```bash
curl -X POST "https://sub.example.com/api/import" \
  -H "X-API-Token: <API_TOKEN>" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  --data-binary "vless://uuid@example.com:443?security=tls#API节点"
```

请求正文中可用换行分隔多个完整节点；JSON 也可通过 `nodes` 字符串数组传入多个完整节点。每次最多导入 100 个地址或完整节点。相同内容不会重复追加。模板导入会按地址顺序、再按模板行顺序追加，完整节点按输入顺序追加；已有节点顺序保持不变。批次内任一输入无效时整批拒绝，不会写入部分结果。修改模板只影响之后生成的节点，不会改写已有节点。API 节点仅保存在 API 订阅数据中，不会写进主订阅编辑框；读取主订阅链接时，系统会把它们动态放在所有主订阅节点之后。

配置 `TGTOKEN` 和 `TGID` 后，通过 API 实际新增节点以及保存主订阅内容都会发送 Telegram 通知。

POST 导入最多接收 12 MiB 请求体，读取超时为 15 秒，分别返回 413 / 408。请求头 Token 会在读取正文前校验；继续兼容 JSON 和表单中的 Token。多处同时传递时，以请求头、URL、正文的顺序取值。

管理接口同样按实际请求流限制大小并设置 15 秒读取超时：主订阅正文 20 MiB、分享 JSON 7 MiB（节点内容仍限 1 MiB）、API 模板 JSON 2 MiB、设置 JSON 256 KiB、登录表单 16 KiB。JSON 上限包含转义开销，原有节点和模板规则继续生效。

升级已有部署不需要新建或重新绑定 KV，也不需要改环境变量；但 v3 不再读取旧 `LINK.txt` 或 v2 记录，需要从备份重新保存主订阅、设置、API 节点并创建分享。

订阅链接会根据 User-Agent 自动返回合适格式，也可以显式指定：

```text
https://sub.example.com/s/<id>          # 智能适配 / Base64
https://sub.example.com/s/<id>?base64   # Base64
https://sub.example.com/s/<id>?clash    # Clash / Mihomo
https://sub.example.com/s/<id>?singbox  # Sing-box
https://sub.example.com/s/<id>?surge    # Surge
https://sub.example.com/s/<id>?quanx    # Quantumult X
https://sub.example.com/s/<id>?loon     # Loon
```

## 页面响应与订阅超时排查

编辑器输入后立即显示未保存状态，统计和本地草稿在停止输入 250 ms 后更新；保存、切换到后台或离开页面时补齐待写草稿。分享页只在打开“从已有节点选择”时加载候选，先显示本地节点，再补充上游节点。列表每批显示 100 条，搜索覆盖全部候选；“选择当前结果”会选中全部筛选结果，包括尚未显示的部分。上游读取失败时保留已加载节点，可点击重试。

在浏览器开发者工具的 Network 中查看响应头 `Server-Timing`：`settings` 是站点设置读取，`main_read` / `nodes_read` 是节点读取，`upstream` 是上游获取，`conversion` 是格式转换，`app` 是 Worker 总耗时。阶段可能嵌套，不应简单相加；只显示本次执行的阶段。若总等待明显大于 Worker 耗时，需要继续检查客户端网络、连接与传输。

v2rayN 通过代理更新正常、直连超时，不一定是项目处理慢。可以在有问题的电脑上，关闭 TUN 后用以下命令分别测试 IPv4 / IPv6；只填写域名，登录页无需提供订阅凭证：

```powershell
curl.exe -4 --noproxy "*" --connect-timeout 5 --max-time 15 -sS -o NUL -D - "https://你的域名/login"
curl.exe -6 --noproxy "*" --connect-timeout 5 --max-time 15 -sS -o NUL -D - "https://你的域名/login"
```

IPv4 成功而 IPv6 超时，说明需要检查 IPv6 路径和客户端回退行为；两者都失败则还需检查 DNS 与直连路由。建立连接前的失败不能由 Worker、订阅参数或 HTTP 重定向修复。本轮优化不修改 DNS、代理设置或客户端网络配置。

## 数据与安全说明

- 主订阅、分区设置、API 节点与分享使用 `NODE2LINK.v3.*`，不回读旧格式；API 模板与已保存 Token 仍使用 `NODE2LINK.api-subscription.settings.json`，首次初始化使用独立固定 bootstrap 键；完整键布局见架构文档；
- API Token 是外部追加节点的写入凭证，请勿公开；如发生泄露，可在“API 订阅”页重新生成并保存，旧调用地址随即失效；
- 分享 ID 使用加密安全随机数生成，无法从管理账号或节点内容推导；
- 分享链接本身就是访问凭证，请只发送给需要的人；如发生泄露，可直接重置为新的随机链接；
- 删除分享会发布删除标记，使链接失效，无法从管理页恢复；历史记录仍保留，边缘节点可能在 KV 同步完成前短暂返回旧内容；
- 修改 `ADMIN_PASSWORD` 或 `SESSION_SECRET` 会使使用新配置的实例拒绝旧登录会话，但不会改变订阅链接；会话签名升级后管理员需重新登录一次；
- 主订阅用固定 head 指向独立正文版本，保留最近一次保存版本恢复及 20 MiB 上限；不回读旧 `LINK.txt` 与 `LINK.backup.txt`；
- 转换非 Base64 格式时，节点来源会提交给已配置的转换服务，请使用你信任的服务；订阅响应及向转换服务发起的请求均带有禁止缓存指令，但转换服务本身仍需正确遵守这些指令。

## 致谢

基于 CF-Workers-SUB 的订阅处理能力，并感谢 [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR)、[Sublink Worker](https://github.com/7Sageer/sublink-worker) 等项目。
