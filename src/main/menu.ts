/**
 * 应用菜单。快捷键统一用 CmdOrCtrl，在 Windows 上是 Ctrl，在 macOS 上是 Command。
 */
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'

export function buildAppMenu(send: (command: MenuCommand) => void): Menu {
  const isMac = process.platform === 'darwin'
  const isDev = !app.isPackaged

  const fileMenu: MenuItemConstructorOptions = {
    label: '文件',
    submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
      { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
      { type: 'separator' },
      { label: '导出 Word…', accelerator: 'CmdOrCtrl+E', click: () => send('export-word') },
      { type: 'separator' },
      { label: '关闭教学案，返回首页', accelerator: 'CmdOrCtrl+W', click: () => send('close') },
      ...(isMac ? [] : [{ type: 'separator' } as const, { label: '退出', role: 'quit' } as const])
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      { label: '放大界面', role: 'zoomIn' },
      { label: '缩小界面', role: 'zoomOut' },
      { label: '界面实际大小', role: 'resetZoom' },
      { type: 'separator' },
      { label: '全屏', role: 'togglefullscreen' },
      ...(isDev
        ? [
            { type: 'separator' } as const,
            { label: '重新加载', role: 'reload' } as const,
            { label: '开发者工具', role: 'toggleDevTools' } as const
          ]
        : [])
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: `关于 ${app.name}`, role: 'about' },
              { type: 'separator' },
              { label: `隐藏 ${app.name}`, role: 'hide' },
              { label: '隐藏其他', role: 'hideOthers' },
              { type: 'separator' },
              { label: `退出 ${app.name}`, role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    fileMenu,
    editMenu,
    viewMenu
  ]

  return Menu.buildFromTemplate(template)
}
