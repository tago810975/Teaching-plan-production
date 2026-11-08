# 教学案制作（Teaching-plan-production）

导入题目文档、自动排版，一份工程同时导出教师版（教案）与学生版（学案）Word 文档的桌面软件。支持 Windows，后续移植 macOS。

## 开发环境

- Node.js 22 或更高版本
- Windows 10/11（macOS 亦可运行开发版）

```bash
npm install        # 安装依赖（首次会下载 Electron，约 100 MB）
npm run dev        # 启动开发版，修改界面代码后自动刷新
npm test           # 运行单元测试
npm run typecheck  # 类型检查
npm run dist:win   # 打包 Windows 安装程序，输出到 release/
```

## 常见问题

**启动时报错 `Failed to resolve import "xxx"`**

代码新增了依赖库，而本地还没有安装。每次 `git pull` 之后都执行一次 `npm install`（依赖没有变化时几秒钟就结束）。

**启动时报错 `Error: Electron uninstall`**

Electron 的主程序（约 100 MB）在 `npm install` 的最后一步从 GitHub 下载，网络不通时会静默失败。指定国内镜像后单独重新下载即可：

```bash
# Git Bash / MSYS2
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

```bat
:: 命令提示符（cmd）
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node node_modules\electron\install.js
```

成功后 `node_modules/electron/dist/` 下会出现 `electron.exe`。

**PowerShell 提示“禁止运行脚本”**

改用命令提示符（cmd），或在 PowerShell 中执行一次 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

## 使用说明

- 启动后进入首页，列出“教学案库”（默认为“文档\教学案”）中的全部教学案，以及最近打开过的其他位置的教学案。
- “新建教学案”只需输入名称，文件立即创建在教学案库中，并自动带入模板的页眉（Logo、电话、水印）。
- 教学案库可以建子文件夹分类管理（最多两层），首页会一并列出。
- 编辑时点击左上角“首页”或按 Ctrl+W 返回首页。
- 导入：首页“从 Word 文档新建”，或编辑界面“导入 Word 题目”（插入到当前选中内容之后）。
  使用“物理排版”样式的文档按样式精确识别；其他文档按“1.”题号、“A.”选项、“【答案】”“【解析】”等标记识别。
- 公式：在预览中点击任意公式即可可视化编辑（含模板按钮与数学键盘）；属性面板中“插入公式”在光标处插入新公式。
  从 Word 导入的公式打开后若未修改，导出时原样保留。
- 点击定位：在预览中点击任意一行，右侧对应的输入框会滚动到该段，光标停在点击的位置附近。
- 综合题：标题（如“材料一”）+ 可选的背景材料与配图 + 若干小题（题号与全卷连续）+ 共用的答案与详解。
  大纲中小题缩进列在综合题之下，点击即可单独编辑；拖动综合题时小题随之移动。
- 知识点：知识梳理按“一、二、三……”标题分组为知识点（标题、内容、插图），与题目一样可设置留白、跨页与换页；
  “添加”菜单中也可以新建知识点。
- 图片位置：题目的图可放在题干下方、题干右侧、题干下方位于选项/小问右侧、某个小问下方、全部题目文字下方，
  或自由位置；知识点的插图可放在某段之后、某段右侧或自由位置。选中题目或知识点后，在预览中拖动图片右下角
  可等比缩放；右侧的图可上下拖动，自由位置的图可任意拖动，文字会绕开图片排布。
- 知识点的段落设置：每段可设置段后空行、从此段换页，也可从某段拆分出新的知识点。
- 大纲排序：在大纲中按住一项约 0.3 秒即可拖动，松开放到蓝色插入线处；拖动时滚动鼠标滚轮可快速翻动大纲，
  拖到大纲上下边缘会自动滚动，按 Esc 取消。
- 左侧大纲栏与右侧属性栏的宽度可调：鼠标移到边界上按住拖动；双击边界恢复默认宽度。调整后的宽度会被记住。
- 版式设置（大纲顶部）：教案、学案分别设置每道题是否整题同页。教案默认允许跨页以节省纸张，
  学案默认整题同页；单道题可在“版式”中另行设置。
- 导出：编辑界面“导出 Word”（Ctrl+E），可同时导出教案与学案。导出的文档沿用模板样式，
  题号、小问号、【答案】等由 Word 自动编号生成，公式为 Word 原生公式，其他老师可以直接编辑。

## 目录结构

```
src/
  core/        纯逻辑，不依赖界面，可单独测试
    model/         数据模型、校验、工厂函数
    project-file/  工程文件 .tplan 的读写
    document/      排版规则（build.ts）、文档中间表示（ir.ts）、样式表、分页
    sample/        演示内容
  shared/      主进程与界面之间的通信接口
  main/        Electron 主进程：窗口、菜单、文件读写
  preload/     向界面暴露受限的 API
  renderer/    界面（React）：大纲、分页预览、属性面板
test/          单元测试
reference/     参考样例教学案及其分析
docs/          设计文档（技术选型等）
```

## 核心约定

**预览与导出一致**：工程数据先由 `core/document/build.ts` 生成文档中间表示（DocIR），预览和 Word 导出都只读取 DocIR。所有排版规则（题号、选项分列、教师版/学生版取舍、留白、防跨页）只能写在 `build.ts` 中。

**工程文件**：`.tplan` 是 ZIP 容器，改扩展名为 `.zip` 即可解压查看。格式说明见 `src/core/project-file/format.ts`。

**依赖版本**：全部固定为确切版本，且只选用发布满两周的版本。
