import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { registerBookIpc } from './book.ipc'
import { registerChapterIpc } from './chapter.ipc'
import { registerModelIpc } from './model.ipc'
import { registerAiIpc } from './ai.ipc'
import { registerOutlineIpc } from './outline.ipc'
import { registerBookSettingIpc } from './book-setting.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerChatMessageIpc } from './chat-message.ipc'
import { registerAgentIpc } from './agent.ipc'
import { registerRoleDialogueIpc } from './role-dialogue.ipc'
import { registerChatRoomIpc } from './chat-room.ipc'
import { getDbPath, importDatabase } from '../db/index'

export function registerAllIpc() {
  ipcMain.handle('shell:openExternal', (_, url: string) => shell.openExternal(url))
  ipcMain.handle('app:quit', () => {
    setTimeout(() => app.quit(), 0)
    return true
  })
  ipcMain.handle('app:versions', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))
  ipcMain.handle('app:devtools', () => {
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
    return true
  })
  ipcMain.handle('db:export', async () => {
    const dbPath = getDbPath()
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出数据库',
      defaultPath: `ainovel-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
      properties: ['createDirectory'],
    })
    if (canceled || !filePath) return { success: false, reason: 'cancelled' }
    try {
      await copyFile(dbPath, filePath)
      return { success: true, path: filePath }
    } catch (e) {
      return { success: false, reason: String(e) }
    }
  })
  ipcMain.handle('db:import', async () => {
    const dbPath = getDbPath()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入数据库',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    })
    if (canceled || filePaths.length === 0) return { success: false, reason: 'cancelled' }
    const src = filePaths[0]
    if (src === dbPath) return { success: false, reason: 'same_file' }
    return importDatabase(src)
  })
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
    return true
  })
  registerBookIpc()
  registerChapterIpc()
  registerModelIpc()
  registerAiIpc()
  registerOutlineIpc()
  registerBookSettingIpc()
  registerSettingsIpc()
  registerChatMessageIpc()
  registerAgentIpc()
  registerRoleDialogueIpc()
  registerChatRoomIpc()
}
