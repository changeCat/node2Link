# Cloudflare Pages 部署与升级手册

本项目以当前仓库的 `main` 分支为唯一代码主线，不再同步已经归档的上游仓库。GitHub 推送仍由 Cloudflare Pages 的 Git 集成自动部署。

## 一、重构后的部署链路

```text
push main
  → Cloudflare Pages 拉取代码
  → npm ci 安装 package-lock.json 中的固定版本依赖
  → npm run pages:build
  → 语法检查
  → 生成 dist/_worker.js 和 dist/assets/*
  → 自动测试
  → 全部通过后发布 dist
```

构建或测试失败时，本次部署会失败，当前线上成功版本不会被替换。

## 二、首次升级前的一次性 Cloudflare 设置

以下设置只需修改一次。以后正常更新只需要向 `main` 分支 push。

1. 登录 Cloudflare Dashboard。
2. 打开 `Workers & Pages`。
3. 选择当前 Pages 项目。
4. 打开 `Settings`。
5. 找到 `Builds & deployments` 中的构建配置并点击编辑。
6. 将生产分支设置为 `main`。
7. 将 Framework preset 保持为 `None` 或无框架。
8. 将 Build command 设置为：

   ```text
   npm run pages:build
   ```

9. 将 Build output directory 设置为：

   ```text
   dist
   ```

10. Root directory 留空，表示仓库根目录。
11. 保存设置。

仓库内的 `.nvmrc` 固定使用 Node.js 22，通常不需要在 Cloudflare 中额外配置 Node 版本。

> 应在本次重构代码 push 前完成上述设置。如果提前保存后 Cloudflare 尝试构建旧提交，旧提交可能因为还没有 `pages:build` 命令而构建失败；这不会替换当前线上版本。随后 push 新代码即可恢复自动构建。

## 三、确认原有绑定和变量

重构不要求新建 KV，也不会修改 KV Namespace ID、域名或已有订阅地址。

在 Pages 项目的 `Settings → Bindings` 中确认：

- KV Namespace binding 的变量名仍为 `KV`；
- 绑定的仍是当前线上正在使用的 KV 命名空间。

在生产环境变量中确认：

- `ADMIN_PASSWORD` 存在；
- `SESSION_SECRET` 建议存在；
- 其他 `TOKEN`、`SUBAPI`、`SUBCONFIG`、`TGTOKEN`、`TGID` 等变量保持原值；
- 不需要因为本次重构重新填写或删除任何变量。

不要把密码、Token、KV ID 等生产配置写进仓库的 `wrangler.toml` 或普通代码文件。

## 四、本地验证

首次在本地获取本次代码后执行：

```bash
npm ci
npm run pages:build
```

成功时应完成语法检查、生成 `dist` 并运行全部测试。`dist` 是构建产物，已被 `.gitignore` 排除，不需要提交到 GitHub。

也可以分别执行：

```bash
npm run check
npm run build
npm test
```

需要在浏览器中预览时执行：

```bash
npm run dev
```

然后打开 `http://127.0.0.1:8788`，默认本地账号为 `admin`，密码为 `dev-password`。本地预览使用内存 KV，停止进程后测试数据会清空，不会连接或修改 Cloudflare 生产 KV。可通过 `NODE2LINK_DEV_USERNAME`、`NODE2LINK_DEV_PASSWORD` 和 `NODE2LINK_DEV_PORT` 修改本地预览配置。

## 五、首次发布重构版本

1. 完成第二节的 Cloudflare 构建配置。
2. 在本地确认 `npm run pages:build` 成功。
3. 提交代码并推送：

   ```bash
   git add -A
   git commit -m "refactor: optimize Pages build and KV access"
   git push origin main
   ```

4. 打开 Cloudflare Pages 项目的 `Deployments`。
5. 等待最新 `main` 部署显示成功。
6. 打开部署详情，确认构建命令为 `npm run pages:build`，输出目录为 `dist`。

GitHub 的 `Verify` Action 也会执行相同检查。它用于额外记录代码检查结果；真正阻止错误版本发布的是 Pages 自己执行的 `pages:build`。

## 六、发布后验证

按顺序检查：

1. 打开 `/login`，确认登录页样式正常。
2. 登录后打开 `/`，确认主订阅、编辑器和图标正常。
3. 打开 `/shares`，确认分享列表正常。
4. 点击一个分享的“修改”，确认节点内容能在点击后加载。
5. 创建一个临时分享，复制链接并请求一次订阅。
6. 对临时分享执行“重置链接”，确认旧链接返回 404，新链接可用。
7. 打开 `/requests`，确认请求统计能显示。
8. 打开 `/assets/base.css` 和 `/assets/lucide.js`，确认返回 200。
9. 在浏览器开发者工具 Network 中确认不再请求 `unpkg.com` 或 `cdn.jsdelivr.net`。
10. 确认 `/assets/*` 响应包含静态缓存头，而管理页面和订阅响应仍为 `no-store`。
11. 查看管理页面响应的 `Server-Timing`，确认能看到 `app;dur=...`。

已有分享索引会在第一次打开分享管理页时自动补充摘要。因此第一次打开可能比后续访问多一些 KV 读取，这是一次性操作。节点内容、分享 ID 和订阅链接不会改变。

## 七、以后日常更新

日常更新不再需要进入 Cloudflare：

```bash
git pull
npm ci
npm run pages:build
git add -A
git commit -m "说明本次修改"
git push origin main
```

push 后 GitHub Verify 和 Cloudflare Pages 都会自动运行。Pages 成功后自动切换线上版本。

## 八、取消上游同步后的行为

原 `.github/workflows/sync.yml` 已删除，因此：

- 不会再定时拉取归档上游；
- GitHub Actions 中不再出现 `Upstream Sync`；
- 上游提交不会进入当前 `main`；
- 当前仓库的提交是唯一发布来源。

如果以后需要参考其他项目的某项修改，应人工审查后单独移植，不要重新开启整仓自动同步。

## 九、失败处理与回滚

### Pages 构建失败

1. 打开失败部署的 Build log。
2. 查找 `npm ci`、`check`、`build` 或测试失败位置。
3. 本地修复后重新执行 `npm run pages:build`。
4. push 新提交，Pages 会自动重新部署。

### 新版本运行异常

1. 打开 Cloudflare Pages 的 `Deployments`。
2. 找到上一个成功版本。
3. 使用 Cloudflare 提供的回滚/重新部署功能恢复它。

分享索引同时保存旧版 ID 和新版摘要，旧部署仍能识别分享列表。订阅内容和分享详情仍保存在原 KV 键中，构建部署不会清空 KV。

### 静态资源返回 404

优先检查：

- Build output directory 是否为 `dist`；
- 构建日志中是否生成 `dist/assets`；
- 部署文件中是否存在 `_routes.json`；
- 是否错误地把 Root directory 设置成了 `dist`。Root directory 应留空，只有输出目录填写 `dist`。

### 页面仍访问第三方 CDN

先确认最新部署成功，再强制刷新浏览器。旧 HTML 不应长期缓存，但浏览器标签页可能仍保留旧页面实例。
