# Physics Lab · 物理互动演示实验室

以 Astro 静态生成首页，以独立 HTML、原生 JavaScript、Canvas 和 SVG 运行物理实验。Cloudflare Worker 提供静态资源与留言 API，D1 保存留言。实验计算在浏览器中完成。

## 开发与验证

推荐 Node.js 24 LTS（最低 22.23.4）与 npm，CI 使用 Node 24。首次安装：

```powershell
npm ci
npx playwright install chromium
npm run dev
```

Astro 开发服务器默认位于 `http://localhost:4321`，仅预览静态实验；留言需使用下方 Worker 开发流程。

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 校验实验清单、递归 HTML、内部资源、重复 ID、脚本语法与字面量 DOM 引用 |
| `npm run check:types` | 显式检查 Astro/TypeScript/JSDoc 类型 |
| `npm run test:unit` | 检查物理模型边界、守恒量和公共动画运行时 |
| `npm run test:comments` | 用 Node 内存 SQLite 执行真实 Worker 的隔离集成测试；不访问网络或生产数据库 |
| `npm run build` | 生成 `dist/` |
| `npm run test:browser` | 在已构建产物上运行 Chromium 桌面和手机冒烟测试 |
| `npm run validate` | 语法、内容、类型、模型/运行时、留言测试和生产构建 |
| `npm run validate:full` | `validate` 加浏览器冒烟测试；与 CI 使用相同入口 |
| `npm run preview` | 预览生产静态产物 |

浏览器检查遍历全部实验页（包括隐藏卡片对应页面），验证页面异常、内部资源和有效 Canvas / SVG 尺寸，并验证首页搜索、分类、URL 状态与代表性播放/暂停/重置操作。该测试模拟只读留言响应；真实 API 由隔离集成测试验证。需要保存截图时设置 `BROWSER_SCREENSHOTS=1`，输出至 `artifacts/browser/`。本机已安装 Edge 时可设 `BROWSER_TEST_CHANNEL=msedge`；默认使用 Playwright Chromium。`BROWSER_TEST_URL` 可指定已经运行的静态预览地址。

内容检查刻意只验证可静态确定的资源与 DOM ID；计算生成的 ID、运行时状态、物理结果仍需对应模型测试或浏览器检查。通过构建不等于物理模型已获得实验验证。

## 新增实验

1. 在 `public/` 创建独立 HTML，加入 `<title>`、viewport、返回 `/` 的链接以及 Canvas 或 SVG 的可访问名称。
2. 引入共享样式与运行时：

   ```html
   <link rel="stylesheet" href="/lab-common.css">
   <script src="/lab-runtime.js"></script>
   ```

3. 在 `src/data/experiments.json` 的对应分类中增加条目：

   ```json
   {
     "title": "光电效应实验",
     "desc": "调节光频率与反向电压，观察截止条件。",
     "image": "/covers/photoelectric.png",
     "link": "/光电效应.html",
     "publishedAt": "2026-11-02T12:00:00+08:00",
     "hidden": false
   }
   ```

   `image` 或 `icon` 至少填一项；路径必须以 `/` 开头。`hidden: true` 只隐藏首页入口，页面仍能直接访问，也会接受内容和浏览器检查，不用于访问控制。分类 ID、链接、发布日期和必填项由 `src/data/experiments.mjs` 的 Zod schema 校验，首页与检查脚本共享此数据。可见条目按发布时间倒序。

4. 将可独立验证的物理计算提取为纯函数，给出模型假设、单位与有效范围。共享模型位于 `public/lab-physics.js`。数值积分优先使用固定时间步 `PhysicsLab.createFixedStepper()`，重力轨道可使用 `PhysicsLab.stepGravity()`；`frameScale()` 适合既有视觉演示的帧率归一化，不替代稳定积分算法。Canvas 可使用 `resizeCanvas()` 与 `observeResize()` 处理设备像素比和容器变化。`createAnimation()` 提供统一动画生命周期。
   SVG 演示在根 `<svg>` 加 `data-lab-export` 和可访问名称，即可使用公共参数链接及 PNG 导出。数值恢复结束会发送 `physicslab:state-restored` 事件，`detail.values` 为原始保存值；依赖多组参数的页面可在此统一恢复局部时间或其它派生状态。
5. 执行 `npm run validate:full`，检查桌面与手机布局、边界参数及暂停/重置状态。

首页支持关键词和分类组合筛选。当前状态保存在 `?q=关键词&category=optics` 中，可以直接分享或刷新恢复；无 JavaScript 时仍显示全部已发布条目。实验页的公共工具还支持复制参数链接和导出 PNG；课堂名单不会包含在分享链接中。

参数链接保存有 ID 的数值、范围、复选框和选择控件，以及明确声明的模式按钮；不保存名单、留言、凭据或拖拽视角；动画时间仅在页面显式声明为数值控件时保存，也不会携带原地址中的未知查询参数和片段。新实验的模式按钮可加 `data-lab-share` 和稳定 ID，用 `active` 类或 `aria-pressed` 表示当前状态；可开关的模式另加 `data-lab-share-toggle`。也支持现有的 `data-mode`、`data-scene`、`data-step` 等模式属性。

Windows 云同步目录若出现依赖文件 `UNKNOWN: unknown error, read`，先在不参与同步的本地目录用同一锁文件执行 `npm ci` 和 `npm run validate:full`，区分文件系统问题与代码错误；不要依赖跨机器同步的 `node_modules`。

## 圆环碰撞演示

`public/圆环碰撞.html` 改编自本地圆环碰撞教学项目，对应 2024 湖南物理第 15 题第三问。模型、交互、样式及离线导出分别位于 `public/ring-collision/`。假设圆环光滑固定、mA > mB、0.2 ≤ e ≤ 1，n 最大 40。Q 是累计加权弧坐标，V = dQ/dt 恒定，P 仅将 Q 绕回圆环，不代表平面质心。模型通过分段精确时刻与有理数圈数余量避免后期相位丢失；极大时长使用科学计数，区间压缩不代表真实时间。

课堂工具可分享当前碰撞区间、局部进度和参数，导出三个 SVG 图的 PNG。页脚“下载离线版”生成含样式与模型的独立 HTML；离线版不包含站点评论和公共工具。`tests/ring-collision.test.cjs` 检验碰撞守恒、恢复系数、奇偶碰撞关系和第 81 次碰撞极端情况。

## 留言开发

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run build
npm run comments:migrate:local
npm run comments:dev
```

在 `.dev.vars` 填入本地测试配置。Turnstile 测试使用 Cloudflare 官方测试 Site/Secret Key；两者必须同时配置或同时为空。本地匿名模式可以无 Turnstile；生产 CI 要求管理员令牌和独立哈希盐。

| 位置 | 内容 |
| --- | --- |
| `worker/index.js` | 请求校验、留言列表/回复、幂等提交、限流和管理员软删除 |
| `migrations/` | D1 表、索引与 schema 版本；隔离测试也执行同一批 SQL |
| `public/lab-comments.js` / `.css` | 按页面隔离的留言界面 |
| `scripts/test-comments-isolated.mjs` | 无外部服务的 Worker/D1 集成测试 |
| `scripts/test-comments-api.mjs` | 可选的外部 Wrangler 集成测试，需专用测试环境 |

引入运行时的实验页会自动加载留言入口。管理模式使用 `?comments-admin=1`；令牌只用于已授权的管理操作。删除会清空当前记录的昵称与正文并保留线程和幂等标记；历史备份与恢复点的保留周期应另行管理。

## CI 与生产发布

`.github/workflows/deploy-cloudflare.yml` 将验证和发布分为两个 job：PR 与 main 提交均执行完整检查；只有 main 的成功验证产物进入部署。建议在分支保护中将验证 job 设为必需检查。验证可以取消旧任务，生产发布串行执行且不会被后续提交中断。

GitHub Actions Secrets：

- `CLOUDFLARE_API_TOKEN`：目标账户的 Workers Scripts Edit、D1 Edit 权限。
- `COMMENTS_ADMIN_TOKEN`：强随机管理员令牌。
- `COMMENTS_HASH_SALT`：独立强随机盐，用于匿名来源的限流哈希。
- `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`：成对填写；同时留空时保留 Worker 已有的 Turnstile 配置，避免发布时意外关闭验证。全新 Worker 无此配置时采用匿名限流模式。需要停用时应明确清空服务端两项配置后验证行为。

发布顺序是：验证配置 → 应用兼容数据库迁移 → 配置密钥 → 发布 Worker 和已验证静态产物 → 探测 schema readiness 与真实留言列表。任何必需配置缺失都会失败。业务探测为只读，不向生产插入测试留言。站点地址同时记录在 `astro.config.mjs` 和部署探测配置中，换域名时须一起更新。

首次部署需先创建 `wrangler.jsonc` 中绑定的 D1 数据库，并建立同名 Worker（以便写入 secrets）；此仓库已配置现有 `physics` Worker 与 `physics-comments` 数据库。数据库 ID 和 Account ID 是标识，不是凭据。

### 迁移与回滚

- 发布前的迁移只允许旧 Worker 也能使用的新增表、列或索引。重命名、删除列、改变既有数据含义必须分批完成：先兼容新旧结构 → 发布新代码并观测 → 后续独立迁移清理旧结构。
- 发布前记录当前 Worker deployment/version ID，并检查 D1 备份或 Time Travel 恢复点。保留该次成功 CI 产物与 Git 提交，作为可追溯发布记录。
- 新代码异常而 schema 仍向后兼容时，使用 Cloudflare 控制台或 `wrangler rollback <已知正常版本ID>` 恢复 Worker，然后重新运行只读探测。PowerShell 命令为 `$env:COMMENTS_PROBE_URL='https://huang-physics.top'; node scripts/probe-comments.mjs`。发布也可能改变 secrets；必要时用原配置重新部署，不能仅假设回滚会恢复所有外部状态。
- 不自动反向执行 SQL，不自动恢复生产数据。若数据迁移本身有误，先保留故障现场并停止进一步写入，再依据受影响数据范围选用修复迁移或 D1 恢复点。恢复前核对期间新增留言的保留方案。
- readiness 或业务探测失败会使发布 job 失败，但不会自动回退，避免在数据库变更后执行不兼容回滚；维护者应根据上面的兼容性条件决定恢复版本。

`dist/`、`.astro/`、`node_modules/`、`.dev.vars` 不应提交。`artifacts/` 是本地检查输出，可按需保留需要审阅的截图或报告。
