# Cloudflare Pages 全新部署

本项目使用 Cloudflare Pages Git 集成。推送 `main` 后执行 `npm run pages:build`，成功后自动发布 `dist`。

## 必需绑定

生产环境必须同时提供以下绑定，变量名区分大小写：

- D1 database binding：`DB`
- KV namespace binding：`KV`

绑定由你在 Cloudflare Dashboard 中手动创建。保存或更换绑定后，需要重新部署一次，新的 Worker 才能使用它们。缺少绑定或绑定类型错误时，应用返回 503 并指出不可用的 D1 或 KV。

首次部署前必须在 D1 控制台完整执行 [0001_storage.sql](migrations/0001_storage.sql)。运行时代码不会执行 DDL、自动建表或升级 schema；以后新增 migration 时也必须先手工执行，再部署依赖该结构的代码。

## Pages 构建配置

```text
Production branch: main
Framework preset: None
Build command: npm run pages:build
Build output directory: dist
Root directory: 留空
```

## 环境变量

已有环境变量名称和含义保持不变：

- `ADMIN_PASSWORD`、`ADMIN_USERNAME`
- `PASSWORD`、`USERNAME`
- `SESSION_SECRET`
- `TOKEN`、`SUBSCRIPTION_ID`
- `LINK`、`LINKSUB`
- `SUBNAME`、`SUBAPI`、`SUBUPTIME`
- `API_SUBSCRIPTION_ENABLED`
- `TGTOKEN`、`TGID`
- `WARP`

不要把密码、Token、KV ID 或 D1 ID提交到仓库。

`LINK` 在尚未通过页面保存主订阅时作为初始只读正文；`LINKSUB` 会继续附加到主订阅来源。页面保存主订阅后，以保存内容为准。

## 全新配置

当前代码按空 D1 和空 KV 工作，不读取或迁移历史 KV 格式。首次发布后：

1. 打开 `/login` 并登录。
2. 在主订阅页面保存内容。
3. 在设置页面保存需要覆盖环境变量默认值的设置。
4. 如果启用了 API 订阅，保存模板和 Token，再导入节点。
5. 创建需要的分享链接。

开始使用前应已手工建立两张 D1 表及索引。主订阅首次保存后，D1 中出现 `main.head`，KV 中出现 `blob.main.*`。

## 存储检查

D1 的 `node2link_records` 保存：

- `settings.*`
- `identity`
- `main.head`
- `shares.*`
- `revoked.*`
- `api.settings`
- `api.bootstrap`
- `requests.*`

D1 的 `node2link_nodes` 保存当前 API 节点。

KV 只保存：

- `blob.main.*`：主订阅当前正文和最近一次备份
- `blob.share.*`：JSON 编码后接近 D1 单行限制的极端分享正文

普通分享、设置、API 节点和请求日志不写 KV。

## 验证

本地执行：

```bash
npm ci
npm run pages:build
npm run test:e2e
```

发布后检查：

1. `/login` 返回登录页面。
2. 登录、保存主订阅和读取订阅均成功。
3. 普通分享可以创建、修改、暂停、恢复、重置和删除。
4. `/dashboard` 和 `/requests` 正常加载。
5. D1 两张表及索引已由 migration 手工创建。
6. KV 中只出现 `blob.main.*`；只有极端大分享才出现 `blob.share.*`。

## 故障处理

### 返回 D1 或 KV 绑定不可用

检查当前 Production 部署的 Bindings，确认 `DB` 指向 D1 数据库、`KV` 指向 KV 命名空间，变量名大小写完全一致，然后重新部署最新提交。

### D1 读取或写入失败

确认绑定指向可用数据库，并在 D1 控制台检查两张表和索引是否存在。首次配置时完整运行 [0001_storage.sql](migrations/0001_storage.sql)；后续按版本顺序手工执行新增 migration。

### 页面为空

空数据库首次部署时属于正常状态。登录后重新添加数据即可。环境变量 `TOKEN`、`LINK` 等仍会作为初始配置生效。

### Pages 构建失败

在部署日志中定位 `check`、`test`、`build` 或 `smoke` 的失败步骤。本地修复并通过 `npm run pages:build` 后再推送。


### 自定义转换与默认回退

设置 → 转换配置中选择“自定义服务”，添加名称、类型和基础地址，再单选启用其中一条。添加、编辑和删除直接保存到列表；启用项及默认/自定义模式的选择，需要点击“保存”才生效。保存列表不会顺带保存待生效的选择。失败保留输入或待保存选择，当前生效项保持原值；删除当前生效项后使用默认，不自动启用其他自定义项。支持 Sublink Worker 与 Subconverter，可保存多条但只有一条生效；该项失败后只回退默认，不尝试其他未启用的自定义项。旧的单地址 Subconverter 配置会保留地址和访问密钥路径。

现有 VPS 可以继续使用 `tindy2013/subconverter`，不用更换镜像。已采用校验网关的部署可保留 8100 端口、域名与访问密钥，后端不要额外映射宿主机端口。项目填带密钥路径的基础地址，不附加 `/sub` 或查询参数。

官方原版 a0d4eab 的 [协议模型](https://github.com/tindy2013/subconverter/blob/a0d4eab/src/parser/config/proxy.h) 不包含 VLESS。向 Loon 转换时，项目会拒绝已知节点丢失的结果并回退默认。Sublink Worker 会实际尝试目标接口（包括 /loon、/quanx），不可用或返回无效内容才回退。后续服务沿用这些接口新增支持时可直接使用。Sublink 使用自身规则；Subconverter 与默认回退固定使用代码中的内置规则，不再允许设置自定义规则，旧规则配置和 SUBCONFIG 环境变量不再生效。

`/version` 成功只能证明服务能响应。请实际更新订阅，在通知中核对目标格式、实际转换服务、回退原因，以及 Loon 输入和输出节点数量，再检查节点连接。默认回退也会校验内容；全部转换失败或仍丢失已知节点时返回 502，避免成功更新为残缺节点。来源含远程结构化配置或输出 Remote Proxy 时，通知会说明数量未完全核验。

转换阶段共享 30 秒预算，自定义最多占用 8 秒，失败立即回退默认。普通节点的 Base64 输出本地生成，无需外部转换。通知只显示服务类型与域名，不包含访问密钥路径；但回退到默认服务时，默认后端会收到订阅来源及节点信息，管理页面会明确提示。
