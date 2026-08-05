# 🌌 Physics Lab (物理互动演示实验室)

一个基于 Astro 框架构建的高性能、无需预渲染的“极客风”物理运动学与动力学沙盒。

## 🛠️ 如何新建一个物理仿真动画？

为该项目添加新的互动实验非常简单，只需两步：

### 第一步：创建仿真动画网页
所有的物理实验本身是独立运行的网页界面（不依赖 React 等前端框架，以获得极高的 Canvas 渲染性能）。
1. 在 `public/` 目录下新建一个 `.html` 文件（例如：`光电效应v1.html`）。
2. 在该 HTML 文件中，编写你的物理逻辑和前端 UI。
   - 引入公共响应式样式与仿真运行时，保持移动端布局和动画计时一致：
     ```html
     <link rel="stylesheet" href="/lab-common.css">
     <script src="/lab-runtime.js"></script>
     ```
   - 动画应使用 `PhysicsLab.frameScale(timestamp, lastTimestamp)` 将经过时间换算为 60 Hz 帧单位，避免高刷新率设备改变仿真速度。
   - 建议在左上角保留返回主页的按钮：
     ```html
     <a href="/" style="position: absolute; top: 15px; left: 15px; z-index: 9999; padding: 8px 16px; background: rgba(30, 41, 59, 0.9); border: 1px solid #38bdf8; color: #38bdf8; text-decoration: none; border-radius: 6px; font-weight: bold;"> 🏠 返回展厅 </a>
     ```
   - 尽情使用 HTML5 Canvas、原生 JS 渲染交互。

### 第二步：在主页注册你的动画卡片
准备好你的 HTML 文件和一张截图后，前往 `src/pages/index.astro` 注册它，主页网格和过滤选项卡就会自动识别！

1. 寻找 `index.astro` 文件顶部的 `const categories = [...]` 数据区。
2. 找到你的动画所属的物理领域（如 `optics` 光学、`modern-physics` 近代物理等）。
3. 在该类目的 `animations: []` 数组中插入一段 JSON 配置，例如：
   ```javascript
   {
       id: "modern-physics",
       name: "近代物理",
       color: "#10b981",
       animations: [
           // 👇 插入你的新动画信息
           {
             title: "光电效应实验",
             desc: "动态模拟不同频率光子照射金属版释放光电子的现象与反向截止电压。",
             image: "/covers/photoelectric.png", // 你的封面截图路径（存放在 public/covers/ 下）
             link: "/光电效应v1.html"             // 刚才创建的 HTML 路径
           }
       ]
   }
   ```
4. 保存文件，主页上便会立刻多出一张专属该类的漂亮卡片！

## 🚀 本地开发与部署

| 命令 | 动作 |
| :--- | :--- |
| `npm install` | 安装项目依赖 |
| `npm run dev` | 启动本地开发服务器 (`localhost:4321`) |
| `npm run check` | 检查主页资源、实验页基础结构、重复 ID 与脚本语法 |
| `npm run validate` | 依次执行内容检查和生产构建 |
| `npm run build` | 编译打包你的静态实验室到 `./dist/` 目录 |
| `npm run preview` | 部署前本地预览打包结果 |

## 自动部署

推送到 GitHub 仓库的 `main` 分支后，GitHub Actions 会执行内容检查和生产构建，随后将 `dist` 自动部署到 Cloudflare Pages 的 `physics` 项目。

仓库需要配置 GitHub Actions Secret：

- `CLOUDFLARE_API_TOKEN`：具有目标账户 `Cloudflare Pages: Edit` 权限的 Cloudflare API Token。

工作流配置位于 `.github/workflows/deploy-cloudflare.yml`。Cloudflare Account ID 和项目名不是凭据，已直接记录在工作流中；API Token 不得写入仓库。
