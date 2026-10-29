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

项目已包含 Vercel 配置 `vercel.json` 和 `api/` 下的 Serverless 查询接口。前端与 API 会部署在同一个项目中，无需数据库或 API 密钥。

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

### 2. 在 Vercel 发布

1. 登录 Vercel，选择 **Add New → Project**。
2. 连接 GitHub 并导入刚才的仓库。
3. 框架选择 **Vite**；构建命令为 `npm run build`，输出目录为 `dist`。`api/` 中的接口会被自动识别。
4. 不需要填写环境变量，点击 **Deploy**。
5. 部署完成后，Vercel 会分配 `https://项目名.vercel.app`，把该网址发给别人即可使用。

以后推送到 GitHub 主分支，Vercel 会自动重新部署。

项目仍保留 `render.yaml`，需要时也可通过 Render Blueprint 部署为传统 Node.js Web Service。

### 3. 发布后验收

- 打开公网网址，确认页面可正常显示。
- 访问 `https://你的域名/api/health`，应返回 `status: ok` 和 `platform: vercel`。
- 用 `La Poste` 和 `75015` 做一次真实查询，检查登记地址、官网、公开邮箱、联系页与 Facebook 的来源链接。
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
