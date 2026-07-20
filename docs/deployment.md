# Web deployment

AI Network Check 的在线版通过 GitHub Actions 构建，并部署到 GitHub Pages。

## Online URL

```text
https://jacklv-coder.github.io/ai-network-check/
```

Vite 的 `base` 已配置为 `/ai-network-check/`，以支持项目级 GitHub Pages 地址。

## Deployment pipeline

每次以下内容合并到 `main` 后，部署工作流会自动运行：

- `apps/web/**`
- `packages/**`
- 根目录 `package.json`
- 根目录 `tsconfig.json`
- Pages 工作流本身

流水线按以下顺序执行：

1. 检出仓库
2. 安装 Node.js 22.12.0
3. 执行 `npm install`
4. 执行全部测试
5. 执行 `npm run build:web`
6. 上传 `apps/web/dist`
7. 部署到 GitHub Pages

测试或构建失败时不会发布新版本。

## Repository setting

首次发布前，在仓库中打开：

```text
Settings → Pages → Build and deployment → Source
```

选择：

```text
GitHub Actions
```

工作流也可以在仓库的 Actions 页面中通过 `workflow_dispatch` 手动运行。

## Local verification

```bash
npm install
npm test
npm run build:web
npm run dev:web
```

本地开发地址由 Vite 输出。生产构建文件位于：

```text
apps/web/dist
```

## Deployment security

工作流使用最小权限：

- `contents: read`
- `pages: write`
- `id-token: write`

部署任务使用 GitHub Pages 的 `github-pages` environment，不包含 API Key 或 AI 服务凭证。
