# 官网双站部署与日常维护说明

本项目官网位于 `website/` 目录，使用 VitePress 构建为纯静态页面，采用 **GitHub Pages + Cloudflare Pages 双站自动同步部署**，两者共用同一套代码，零服务器成本。

---

## 一、GitHub Pages 一次性开启步骤

> 原理：本仓库中的 [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) 会在 `website/` 变更推送到 `main` 时自动构建，并直接将静态文件推送到当前仓库 `tago810975/Teaching-plan-production` 的 `gh-pages` 分支。

1. 将当前改动推送到 GitHub `main` 分支（触发 **部署官网到 GitHub Pages** workflow），等待运行成功，此时仓库会出现 `gh-pages` 分支。
2. 打开仓库 **`tago810975/Teaching-plan-production`** 的 **Settings → Pages**。
3. 在 **Build and deployment** 中设置：
   - **Source**：选择 `Deploy from a branch`
   - **Branch**：选择 `gh-pages` 和 `/ (root)`
4. 点击 **Save**，稍等 1～2 分钟即可通过以下地址访问：
   - `https://tago810975.github.io/Teaching-plan-production/`

---

## 二、Cloudflare Pages 一次性绑定步骤（国内访问推荐）

> 原理：Cloudflare Pages 免费版支持直接关联 **私有 GitHub 仓库**，且国内 CDN 访问通常比 GitHub Pages 更稳定、不限流量。

1. 注册并登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 左侧菜单进入 **Workers & Pages → Create → Pages → Connect to Git**。
3. 授权关联你的 GitHub 账号，在仓库列表中选择私有仓库 **`tago810975/Teaching-plan-production`**，点击 **Begin setup**。
4. 按下表填写构建配置（`Production branch` 保持 `main`）：

| 配置项 | 填写内容 |
|---|---|
| **Project name** | 自定义（例如 `teaching-plan`，决定默认域名 `*.pages.dev`） |
| **Framework preset** | `None`（或选 `VitePress` 后确认下方目录与命令一致） |
| **Root directory (advanced)** | `website` |
| **Build command** | `npm run build` |
| **Build output directory** | `.vitepress/dist` |
| **Environment variables (advanced)** | 添加 `NODE_VERSION` = `22` |

5. 点击 **Save and Deploy**。部署完成后，Cloudflare 会分配一个免费的 `https://<project-name>.pages.dev` 访问地址。
6. 以后只要往 `main` 分支 `git push`，**GitHub Pages** 和 **Cloudflare Pages** 两边都会自动构建并同步更新（如需避免非官网改动触发 Cloudflare 构建，也可在 Cloudflare 项目设置 Build watch paths 中限定仅监听 `website/*`）。

---

## 三、后续如何补充网盘链接与更新版本号

只需要编辑一个文件：**`website/.vitepress/data/downloads.ts`**。

1. **更新版本号**：把 `version` 和 `fileHint` 中的版本号改成新发布的版本号（例如 `0.4.0`）。
2. **补充网盘链接**：在 `windows` 和 `macos` 各自的 `channels` 数组里，把网盘分享链接填入 `url`，如有提取码则填入 `code`（无需提取码可留空 `''`）：

```ts
{
  name: '夸克网盘（国内高速）',
  url: 'https://pan.quark.cn/s/你的分享链接',
  code: 'abcd',
  note: '提取后直接运行安装'
}
```

3. 保持 `url: ''` 的渠道会自动显示为“即将补充”占位；一旦填上链接，就会立即变成可点击按钮并附带一键复制提取码按钮。
4. 修改完成后执行 `git commit` 并 `git push` 到 `main`，两个网站会在 1～2 分钟内自动同步生效。

---

## 四、本地预览与构建测试

在项目根目录或 `website/` 目录中，使用以下命令即可本地预览：

```bash
# Windows PowerShell 若禁止运行 npm.ps1，请使用 npm.cmd
cd website
npm.cmd run dev       # 启动本地预览服务器
npm.cmd run build     # 测试默认根路径 / 构建（对应 Cloudflare Pages）
```

如需本地模拟 GitHub Pages 子路径构建：

```powershell
$env:SITE_BASE='/Teaching-plan-production/'
npm.cmd --prefix website run build
```
