# Atlas France

法国企业公开信息查询网站。输入公司名称和邮编后，查询登记地址、公开邮箱、联系页面，以及 Facebook、Instagram、LinkedIn 账号。每项信息附来源；未找到时不会猜测补全。

## 本地使用

需要 Node.js 22 或更新版本。

```bash
npm ci --include=dev
npm run dev
```

浏览器打开 `http://localhost:7100`。

## 发布成可分享的公网网址

项目已包含 Render Blueprint 配置 `render.yaml`，前端和查询 API 会部署在同一个 Web Service 中，无需数据库或 API 密钥。

### 1. 推送到 GitHub

在 GitHub 创建一个空仓库，然后在本目录执行（替换为你的仓库地址）：

```bash
git init
git add .
git commit -m "Publish Atlas France"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

### 2. 在 Render 发布

1. 登录 Render，选择 **New → Blueprint**。
2. 连接并选择刚才的 GitHub 仓库。
3. Render 会读取 `render.yaml`，确认服务名为 `atlas-france`，点击 **Apply**。
4. 等待构建和健康检查完成。
5. Render 分配 `https://你的服务名.onrender.com` 后，即可把该网址发送给别人。

以后推送更新到 GitHub 主分支，Render 会自动重新部署。

### 3. 发布后验收

- 打开公网网址，确认页面可正常显示。
- 访问 `https://你的域名/api/health`，应返回 `status: ok`。
- 用 `La Poste` 和 `75015` 做一次真实查询。
- 分别用手机和电脑检查查询、复制和 CSV 导出。

公开网页搜索和部分公司官网可能限制数据中心访问。如果公网部署后登记地址正常、但官网或社媒不完整，页面会明确显示未找到或待确认，不会生成虚假结果。重要业务使用前请通过来源链接再次核实。

## 验证命令

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

生产启动：

```bash
npm run preview
```

服务默认监听 `0.0.0.0`，并自动使用平台提供的 `PORT` 环境变量。
