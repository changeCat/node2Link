# Node2Link 订阅管理

这是一个以 Cloudflare Pages Git 集成为主要部署方式的节点与订阅汇聚工具。管理端使用账号密码登录，不再使用 `域名/token` 或 `?token=` 进入管理页；`TOKEN` 只作为主订阅入口，确保已有设备无需修改订阅地址。

## 功能

- 账号密码登录管理端，会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`；
- 汇聚多个节点或上游订阅，并输出 Base64、Clash、Sing-box、Surge、QuanX、Loon 等格式；
- 独立设置页，可分别修改主订阅名称、浏览器标签页标题与图标、主订阅入口 Token，并在默认/自建转换服务和默认/自建规则之间切换；转换后端严格按设置二选一，不会在自建模式下回退到默认服务；还可增减及排序“我的订阅”所展示的客户端格式，各设置模块均可独立保存，标签页标题默认使用 `CF-Workers-SUB`；
- “主订阅”“分享管理”和“订阅请求”使用顶部 Tab 切换，访问根路径时默认展示主订阅；启用可选的 API 订阅功能后会增加“API 订阅”Tab；
- API 订阅默认关闭；设置 `API_SUBSCRIPTION_ENABLED=true` 后，可先配置节点及名称模板，再由外部系统通过带唯一 Token 的 URL 一次追加多个域名/IP 地址或完整节点链接；节点只在 API 订阅页维护，但会动态附加到主订阅结果末尾；
- 设置按钮附近显示按北京时间生成的构建版本，便于确认线上部署是否已经更新；
- 独立分享管理页，可为不同节点组生成不同订阅链接，并支持重复创建、修改、重置链接和删除；分享内容既可手动输入节点和 HTTP/HTTPS 上游订阅链接，也可从主订阅与 API 订阅节点中勾选；分享订阅会动态拉取并合并上游内容，并与主订阅使用相同的客户端自适应转换逻辑；
- 主订阅与分享订阅统一使用 `/s/<随机ID>`，管理密码不会出现在订阅地址中；
- 节点检查、去重、草稿、备份与最近一次版本恢复；
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
| `REQUESTLOG` | 否 | `1` | `0` 关闭订阅请求统计，默认开启 |
| `TGTOKEN` | 否 | `123:abc` | Telegram Bot Token |
| `TGID` | 否 | `123456` | Telegram 接收账号或群组 ID |
| `WARP` | 否 | `vless://...` | 附加到主订阅的 WARP 节点 |

旧版 `GUEST`、`GUESTTOKEN` 已不再使用，可以删除。`TOKEN` 默认作为主订阅入口；登录后可在“设置 → 主订阅入口”中手动修改或随机生成新 Token。设置为 `TOKEN` 后，`/TOKEN` 与 `/?token=TOKEN` 均可订阅；留空则停用这两种 Token 入口，但系统生成的 `/s/<随机ID>` 主订阅链接仍然有效。

页面随机生成的主订阅 Token 与新建分享的随机 ID 均为 32 位 Base64URL 字符串；已经存在的旧订阅地址会继续兼容，不会自动变化。

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

分享列表只读取摘要索引，点击“修改”时才按 ID 读取完整节点内容；旧版 ID 索引会在首次访问时自动补充摘要。请求统计单次最多扫描最近 500 条事件。管理页面响应包含 `Server-Timing`，可在浏览器开发者工具中查看 Worker 总处理时间。

## 使用方式

1. 打开部署域名根路径，例如 `https://sub.example.com/`；
2. 使用 `ADMIN_USERNAME`（默认 `admin`）和 `ADMIN_PASSWORD` 登录；
3. 在“主订阅”Tab 保存汇聚节点与上游订阅，右侧复制“我的订阅”链接；
4. 如需 API 订阅，先配置 `API_SUBSCRIPTION_ENABLED=true`，再在“API 订阅”中保存节点模板、名称格式与页面自动生成的唯一 API Token；未启用时该 Tab 和相关接口均不存在；
5. 在“设置”中分别保存基本显示、主订阅入口或转换配置；修改一个模块不会覆盖其他模块；
6. 在“分享管理”中填写分享名称，按行输入节点或 HTTP/HTTPS 上游订阅链接，也可点击“从已有节点选择”；选择器会汇总主订阅中的直连节点、可解析的上游订阅节点，并在 API 订阅启用时加入其生成节点，保存后即可复制独立订阅链接；
7. 在“订阅请求”中分别查看主订阅及当前分享订阅近 30 天的请求记录；已删除分享不再展示；
8. 分享内容修改后原链接保持不变；删除后该链接失效（Cloudflare KV 跨区域同步可能有短暂延迟）。

分享中的上游订阅支持明文节点、Base64 节点，以及 Clash/Mihomo YAML 和 Sing-box JSON。结构化的专属格式会交给当前选择的转换后端处理；默认 Subconverter 可转换为 v2rayN 使用的节点订阅，自建 Sublink Worker 的 `/xray` 仅聚合原始节点或通用 Base64 订阅，因此使用自建服务时应填写提供商的原始节点、通用 Base64 或 Servers-only 链接。上游订阅和转换请求均设有 8 秒超时；不可达或限制 Cloudflare 访问的提供商会被跳过，避免拖到客户端连接超时。

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

完整节点仅通过 `POST text/plain` 上传。请求正文可原样填写 `vless://...`，无需 URL 编码；Token 通过 `X-API-Token` 请求头传入：

```bash
curl -X POST "https://sub.example.com/api/import" \
  -H "X-API-Token: <API_TOKEN>" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  --data-binary "vless://uuid@example.com:443?security=tls#API节点"
```

请求正文中可用换行分隔多个完整节点；JSON 也可通过 `nodes` 字符串数组传入多个完整节点。每次最多导入 100 个地址或完整节点。相同内容不会重复追加。模板导入会按地址顺序、再按模板行顺序追加，完整节点按输入顺序追加；已有节点顺序保持不变。批次内任一输入无效时整批拒绝，不会写入部分结果。修改模板只影响之后生成的节点，不会改写已有节点。API 节点仅保存在 API 订阅数据中，不会写进主订阅编辑框；读取主订阅链接时，系统会把它们动态放在所有主订阅节点之后。

配置 `TGTOKEN` 和 `TGID` 后，通过 API 实际新增节点以及保存主订阅内容都会发送 Telegram 通知。

升级已有部署时不需要新建或重新绑定 KV。原来的 `LINK.txt` 节点数据会直接复用；只需增加登录密码，保留原 `TOKEN` 即可让已有设备继续更新订阅。

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

## 数据与安全说明

- 主节点保存在 `LINK.txt`；设置保存在 `NODE2LINK.settings.json`；API 订阅设置和节点分别保存在 `NODE2LINK.api-subscription.settings.json`、`NODE2LINK.api-subscription.nodes.json`；分享记录保存在 `NODE2LINK.share.*`；
- API Token 是外部追加节点的写入凭证，请勿公开；如发生泄露，可在“API 订阅”页重新生成并保存，旧调用地址随即失效；
- 分享 ID 使用加密安全随机数生成，无法从管理账号或节点内容推导；
- 分享链接本身就是访问凭证，请只发送给需要的人；如发生泄露，可直接重置为新的随机链接；
- 删除分享会删除对应 KV 内容，无法从管理页恢复；边缘节点可能在 KV 同步完成前短暂返回旧内容；
- 修改 `ADMIN_PASSWORD` 或 `SESSION_SECRET` 会使已有登录会话立即失效，但不会改变订阅链接；
- 每次保存主节点前会保留最近一版到 `LINK.backup.txt`，不是完整历史记录；
- 转换非 Base64 格式时，节点来源会提交给已配置的转换服务，请使用你信任的服务；订阅响应及向转换服务发起的请求均带有禁止缓存指令，但转换服务本身仍需正确遵守这些指令。

## 致谢

基于 CF-Workers-SUB 的订阅处理能力，并感谢 [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR)、[Sublink Worker](https://github.com/7Sageer/sublink-worker) 等项目。
