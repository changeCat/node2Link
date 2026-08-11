# Node2Link 订阅管理

这是一个运行在 Cloudflare Workers / Pages 上的节点与订阅汇聚工具。管理端使用账号密码登录，不再使用 `域名/token` 或 `?token=` 进入管理页；`TOKEN` 只作为主订阅入口，确保已有设备无需修改订阅地址。

## 功能

- 账号密码登录管理端，会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`；
- 汇聚多个节点或上游订阅，并输出 Base64、Clash、Sing-box、Surge、QuanX、Loon 等格式；
- 独立设置页，可分别修改主订阅名称、浏览器标签页标题与图标、主订阅入口 Token，并在默认/自建转换服务和默认/自建规则之间切换；还可增减及排序“我的订阅”所展示的客户端格式，各设置模块均可独立保存，标签页标题默认使用 `CF-Workers-SUB`；
- “主订阅”“分享管理”和“订阅请求”使用顶部 Tab 切换，访问根路径时默认展示主订阅；
- 独立分享管理页，可为不同节点组生成不同订阅链接，并支持重复创建、修改、重置链接和删除；分享订阅与主订阅使用相同的客户端自适应转换逻辑；
- 主订阅与分享订阅统一使用 `/s/<随机ID>`，管理密码不会出现在订阅地址中；
- 节点检查、去重、草稿、备份与最近一次版本恢复；
- 独立的近 30 天订阅请求统计页，主订阅与当前仍存在的分享订阅分别记录和展示；
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
| `REQUESTLOG` | 否 | `1` | `0` 关闭订阅请求统计，默认开启 |
| `TGTOKEN` | 否 | `123:abc` | Telegram Bot Token |
| `TGID` | 否 | `123456` | Telegram 接收账号或群组 ID |
| `TG` | 否 | `1` | `1` 开启 Telegram 通知 |
| `WARP` | 否 | `vless://...` | 附加到主订阅的 WARP 节点 |

旧版 `GUEST`、`GUESTTOKEN` 已不再使用，可以删除。`TOKEN` 默认作为主订阅入口；登录后可在“设置 → 主订阅入口”中手动修改或随机生成新 Token。设置为 `TOKEN` 后，`/TOKEN` 与 `/?token=TOKEN` 均可订阅；留空则停用这两种 Token 入口，但系统生成的 `/s/<随机ID>` 主订阅链接仍然有效。

页面随机生成的主订阅 Token 与新建分享的随机 ID 均为 32 位 Base64URL 字符串；已经存在的旧订阅地址会继续兼容，不会自动变化。

`SESSION_SECRET` 只用于给登录会话 Cookie 签名，防止别人伪造登录状态。它不会参与节点加密，也不会改变主订阅或分享订阅地址；可以使用密码生成器创建一段独立的强随机字符串。不设置时系统会退回使用 `ADMIN_PASSWORD`。

获取订阅的 Telegram 通知会显示具体的主订阅名称或分享名称。

### Workers（Wrangler）

1. 创建 KV：

   ```bash
   npx wrangler kv namespace create KV
   ```

2. 把返回的 ID 写入 `wrangler.toml`：

   ```toml
   [[kv_namespaces]]
   binding = "KV"
   id = "你的 KV ID"
   ```

3. 设置敏感变量并部署：

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   npx wrangler deploy
   ```

如需自定义用户名，可在 Cloudflare 控制台添加 `ADMIN_USERNAME` 普通变量，或使用 `wrangler secret put ADMIN_USERNAME`。

### Pages

在 Pages 项目的“设置 → 绑定”中添加 KV 命名空间，变量名必须是 `KV`；然后在“变量和机密”中添加 `ADMIN_PASSWORD`、`SESSION_SECRET`，重新部署项目。

## 使用方式

1. 打开部署域名根路径，例如 `https://sub.example.com/`；
2. 使用 `ADMIN_USERNAME`（默认 `admin`）和 `ADMIN_PASSWORD` 登录；
3. 在“主订阅”Tab 保存汇聚节点与上游订阅，右侧复制“我的订阅”链接；
4. 在“设置”中分别保存基本显示、主订阅入口、转换配置或客户端展示；修改一个模块不会覆盖其他模块；
5. 在“分享管理”中填写分享名称及一个或多个节点，保存后复制独立订阅链接；
6. 在“订阅请求”中分别查看主订阅及当前分享订阅近 30 天的请求记录；已删除分享不再展示；
7. 分享内容修改后原链接保持不变；删除后该链接失效（Cloudflare KV 跨区域同步可能有短暂延迟）。

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

- 主节点保存在 `LINK.txt`；设置保存在 `NODE2LINK.settings.json`；分享记录保存在 `NODE2LINK.share.*`；
- 分享 ID 使用加密安全随机数生成，无法从管理账号或节点内容推导；
- 分享链接本身就是访问凭证，请只发送给需要的人；如发生泄露，可直接重置为新的随机链接；
- 删除分享会删除对应 KV 内容，无法从管理页恢复；边缘节点可能在 KV 同步完成前短暂返回旧内容；
- 修改 `ADMIN_PASSWORD` 或 `SESSION_SECRET` 会使已有登录会话立即失效，但不会改变订阅链接；
- 每次保存主节点前会保留最近一版到 `LINK.backup.txt`，不是完整历史记录；
- 转换非 Base64 格式时，节点来源会提交给已配置的转换服务，请使用你信任的服务；订阅响应及向转换服务发起的请求均带有禁止缓存指令，但转换服务本身仍需正确遵守这些指令。

## 致谢

基于 CF-Workers-SUB 的订阅处理能力，并感谢 [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR)、[Sublink Worker](https://github.com/7Sageer/sublink-worker) 等项目。
