# Cloudflare Pages 部署与 D1 升级手册

本项目以 `main` 分支为发布主线。推送后 Cloudflare Pages Git 集成继续自动执行 `npm run pages:build` 并发布 `dist`。现有环境变量、域名和 KV 绑定保持不变；本次只新增一次 D1 数据库绑定 `DB`。

未绑卡的 Cloudflare 免费账号可以创建 D1。Workers Free 当前包含每天 500 万行读取、10 万行写入以及每个数据库 500 MB 的限制，具体以 [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/) 和 [D1 限制](https://developers.cloudflare.com/d1/platform/limits/) 为准。

## 一、发布链路

```text
push main
  → Cloudflare Pages 拉取代码
  → npm ci
  → npm run pages:build
  → 源码检查、单元测试、构建及产物冒烟
  → 发布 dist
```

检查失败时，新部署不会替换当前成功版本。以后代码更新仍只需提交并推送。

## 二、一次性创建并绑定 D1

1. 登录 Cloudflare Dashboard，打开 `Workers & Pages → D1 SQL database`。
2. 创建一个数据库，例如 `node2link`。免费账号无需先绑定银行卡。
3. 打开当前 Pages 项目，进入 `Settings → Bindings`。
4. 新增 D1 database binding：
   - Variable name：`DB`
   - D1 database：选择刚创建的 `node2link`
5. 确认原 KV Namespace binding 仍为 `KV`，不要替换或删除。
6. 为 Production 绑定；如使用预览分支，也为 Preview 绑定同名数据库或单独的测试数据库。
7. 保存后重新部署最新 `main` 提交，使绑定进入新的部署。

不需要手工执行建表。代码第一次访问空数据库时会自动创建 `node2link_records`、`node2link_nodes` 表和所需索引。仓库中的 `migrations/0001_hybrid_storage.sql` 仅用于审查或显式初始化。

当前代码在没有 `DB` 时会安全回退到 KV v3，所以可以先推送代码再完成绑定。D1 优化只有在绑定生效后的部署中启用。

## 三、保留原部署配置

Pages 构建配置保持：

```text
Production branch: main
Framework preset: None
Build command: npm run pages:build
Build output directory: dist
Root directory: 留空
```

以下配置保持原值：

- KV Namespace binding：`KV`
- `ADMIN_PASSWORD`
- `ADMIN_USERNAME`
- `SESSION_SECRET`
- `TOKEN`
- `SUBAPI`
- `SUBCONFIG`
- `API_SUBSCRIPTION_ENABLED`
- `REQUESTLOG`
- `REQUESTLOG_SAMPLE_RATE`
- `TGTOKEN`
- `TGID`
- 其他已有环境变量

不要把密码、Token、KV ID 或 D1 ID 写入仓库。

## 四、数据切换

本次不在线迁移旧 KV 结构化数据。D1 绑定生效后，请从备份重新保存：

1. 主订阅正文；
2. 设置页各模块；
3. API 订阅模板、Token 和节点；
4. 分享及其链接。

环境变量 `TOKEN` 入口仍保留，但主订阅正文需重新保存。分享重新创建后 ID 会变化，需要更新客户端链接。

旧 KV 数据不会被自动删除。D1 模式不会读取或列出旧设置、身份、分享索引、撤销标记、API 节点批次、API 配置、请求日志及旧节点缓存，因此这些“脏数据”不会增加请求延迟或 KV 操作数，只占用存储空间。旧主订阅正文也不会被扫描。

不要在切换时批量清空 KV。新架构仍用 KV 保存主订阅和可能的溢出分享正文，误删可能破坏现有订阅。只有接近 KV 容量限制时，才应在确认 D1 已稳定、重新录入完成且本地备份可用后，按前缀离线清理旧键。

## 五、本地验证

首次获取代码后执行：

```bash
npm ci
npm run pages:build
```

该命令会执行源码检查、完整单元回归、构建和使用 MemoryD1/MemoryKV 的产物冒烟。浏览器测试可另行运行：

```bash
npx playwright install chromium
npm run test:e2e
```

本地预览：

```bash
npm run dev
```

然后打开 `http://127.0.0.1:8788`。默认账号为 `admin`，密码为 `dev-password`。本地 D1 和 KV 都在内存中，停止进程后数据清空，不连接生产环境。

## 六、发布与验证

代码提交并推送后，等待 Cloudflare Pages 与 GitHub Verify 完成。D1 绑定生效后按顺序检查：

1. 打开 `/login` 并登录；
2. 在主订阅页重新保存内容，复制链接并确认能返回订阅；
3. 在设置页保存显示、入口、转换、客户端和请求日志设置；
4. 如启用 API 订阅，保存模板和 Token，再导入一个测试节点；
5. 创建临时分享并测试修改、暂停、恢复、重置和删除；
6. 打开 `/requests`，确认统计页正常；
7. 打开 `/dashboard`，确认各摘要可加载；
8. 检查 `/assets/base.css` 和 `/assets/lucide.js` 返回 200；
9. 在 Cloudflare D1 控制台确认 `node2link_records` 与 `node2link_nodes` 已建立并开始出现记录；
10. 在 KV 控制台确认主正文使用 `NODE2LINK.v3.main.version.*`；只有接近 D1 行上限的分享才会出现 `NODE2LINK.blob.share.*`。

分享重置通过 D1 batch 同时发布新指针和旧链接撤销；主订阅通过 D1 head 指向 KV 不可变正文。请求日志默认采样 10%，打开统计页时会清理 D1 中已到期的日志行。

## 七、故障处理

### 页面返回 D1 初始化或读取错误

检查当前部署的 Bindings 是否存在变量名完全为 `DB` 的 D1 binding，并确认 KV binding `KV` 仍存在。绑定修改后必须重新部署；只保存设置不会改变已经运行的旧部署。

### 绑定 D1 后数据显示为空

这是预期的空库切换行为，不表示 KV 被删除。按第四节从备份重新录入。不要为了找回旧数据显示而删除新 D1 记录或正文。

### Pages 构建失败

查看部署日志中的 `npm ci`、`check`、`test`、`build` 或 `smoke` 失败位置，本地修复并重新执行 `npm run pages:build` 后再推送。

### 需要回滚

旧版本代码不认识 D1，会忽略 D1 中的新设置、撤销状态和索引，只读取它支持的 KV 格式，可能使旧链接重新出现。优先重新部署最近一个支持 D1 的成功提交。不要删除 D1 数据库、撤销记录或当前 KV 正文来回滚。

### 静态资源返回 404

确认 Build output directory 为 `dist`、Root directory 留空，并检查部署产物中是否存在 `_worker.js`、`_routes.json` 和 `assets`。
