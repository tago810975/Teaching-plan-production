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
