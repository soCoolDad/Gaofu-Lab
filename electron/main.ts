import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerAllIpc } from './ipc'

// 必须在 app.whenReady() 之前设置 app.name
app.name = '稿府 Lab'
app.setName('稿府 Lab')

// 开发模式下禁用 GPU 和沙盒，避免 Chromium 缓存目录权限问题
if (process.env.NODE_ENV !== 'production') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

// better-sqlite3 内部依赖 __filename，需要 polyfill
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
globalThis.__filename = __filename

const require = createRequire(import.meta.url)

process.env.APP_ROOT = path.join(__dirname, '..')

const packageJson = require(path.join(process.env.APP_ROOT, 'package.json')) as {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function setupAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: '稿府 Lab',
    applicationVersion: packageJson.version || app.getVersion(),
    version: `应用版本 ${packageJson.version || app.getVersion()}`,
    copyright: '本地 AI 创作辅助工具',
  })
}

function setupApplicationMenu() {
  setupAboutPanel()

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
      { label: '删除', role: 'delete' },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' },
    ],
  }
  const dispatch = (target: BrowserWindow | null, code: string) =>
    (target ?? win)?.webContents.executeJavaScript(code)

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      {
        label: '设置',
        click: () => dispatch(null, "window.dispatchEvent(new CustomEvent('navigate-to', { detail: { path: '/settings' } }))"),
      },
      { type: 'separator' },
      { label: '打开开发者工具', accelerator: 'CommandOrControl+Option+I', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
      { type: 'separator' },
      {
        label: '隐私政策',
        click: () => dispatch(null, "window.dispatchEvent(new CustomEvent('open-doc-modal', { detail: { title: '隐私政策', docKey: 'privacy' } }))"),
      },
      {
        label: '用户协议',
        click: () => dispatch(null, "window.dispatchEvent(new CustomEvent('open-doc-modal', { detail: { title: '用户协议', docKey: 'terms' } }))"),
      },
      { type: 'separator' },
      {
        label: '欢迎页',
        click: () => dispatch(null, "window.dispatchEvent(new CustomEvent('navigate-to', { detail: { path: '/' } }))"),
      },
      { type: 'separator' },
      {
        label: '关于稿府 Lab',
        click: () => dispatch(null, "window.dispatchEvent(new CustomEvent('navigate-to', { detail: { path: '/settings' } }))"),
      },
    ],
  }

  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([editMenu, viewMenu]))
    return
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: '关于稿府 Lab', role: 'about' },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: '隐藏稿府 Lab', role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出稿府 Lab', role: 'quit' },
      ],
    },
    editMenu,
    viewMenu,
  ]))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    frame: false,
    backgroundColor: '#F6F7FB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // 注册所有 IPC 处理器（在窗口创建之前）
  registerAllIpc()
  setupApplicationMenu()
  createWindow()
})
