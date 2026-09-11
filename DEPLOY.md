# Cloudflare Pages 全新部署

本项目使用 Cloudflare Pages Git 集成。推送 `main` 后执行 `npm run pages:build`，成功后自动发布 `dist`。

## 必需绑定

生产环境必须同时提供以下绑定，变量名区分大小写：

- D1 database binding：`DB`
- KV namespace binding：`KV`

绑定由你在 Cloudflare Dashboard 中手动创建。保存或更换绑定后，需要重新部署一次，新的 Worker 才能使用它们。缺少任一绑定时，应用返回 503 并指出缺少的变量名。

D1 不需要手工建表。首次数据库操作发现表不存在时，代码会自动执行幂等建表。仓库中的 [0001_storage.sql](migrations/0001_storage.sql) 仅供审查或需要时手工初始化。

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
- `SUBNAME`、`SUBAPI`、`SUBCONFIG`、`SUBUPTIME`
- `API_SUBSCRIPTION_ENABLED`
- `REQUESTLOG`、`REQUESTLOG_SAMPLE_RATE`
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

D1 表会在这些操作中自动创建。主订阅首次保存后，D1 中出现 `main.head`，KV 中出现 `blob.main.*`。

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
5. D1 两张表已自动创建。
6. KV 中只出现 `blob.main.*`；只有极端大分享才出现 `blob.share.*`。

## 故障处理

### 返回缺少 DB 或 KV

检查当前 Production 部署的 Bindings，确认变量名严格为 `DB` 和 `KV`，然后重新部署最新提交。

### D1 初始化失败

确认绑定指向可用数据库。自动建表需要执行建表和索引 SQL；如果账号权限阻止自动执行，可在 D1 控制台运行 [0001_storage.sql](migrations/0001_storage.sql)。

### 页面为空

空数据库首次部署时属于正常状态。登录后重新添加数据即可。环境变量 `TOKEN`、`LINK` 等仍会作为初始配置生效。

### Pages 构建失败

在部署日志中定位 `check`、`test`、`build` 或 `smoke` 的失败步骤。本地修复并通过 `npm run pages:build` 后再推送。
