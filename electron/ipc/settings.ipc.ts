import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, resetAllDatabase, resetBooksDatabase } from '../db'
import { applyLogs, modelProviders, promptCaches, contextCaches, tokenUsageLogs, aiChatMessages, aiSettings } from '../db/schema'
import {
  roleDialogueRooms,
  roleDialogueRuns,
  roleDialogueSnippets,
  roleDialogueCharacterModels,
  chatRoomRooms,
  chatRoomParticipants,
  chatRoomMessages,
  chatRoomCharacterModels,
} from '../db/schema'
import { clearPromptCacheMemo } from './ai.utils'
import { SAMPLING_TASKS } from '../utils/sampling'

function deleteAll(table: any) {
  getDb().delete(table).run()
}

const AI_SETTINGS_ID = 'default'

export function registerSettingsIpc() {
  ipcMain.handle('settings:clearBooks', async () => {
    resetBooksDatabase()
    clearPromptCacheMemo()
    return true
  })

  // 读取 AI（「知卷」）设置：返回 JSON 对象或 null
  ipcMain.handle('settings:getAiSettings', async (): Promise<Record<string, unknown> | null> => {
    const row = getDb().select().from(aiSettings).where(eq(aiSettings.id, AI_SETTINGS_ID)).get()
    if (!row) return null
    try {
      return JSON.parse(row.data) as Record<string, unknown>
    } catch {
      return null
    }
  })

  // 保存 AI（「知卷」）设置：整行 upsert
  ipcMain.handle('settings:saveAiSettings', async (_e, data: Record<string, unknown>) => {
    const now = new Date().toISOString()
    const json = JSON.stringify(data ?? {})
    const existing = getDb().select({ id: aiSettings.id }).from(aiSettings).where(eq(aiSettings.id, AI_SETTINGS_ID)).get()
    if (existing) {
      getDb().update(aiSettings).set({ data: json, updatedAt: now }).where(eq(aiSettings.id, AI_SETTINGS_ID)).run()
    } else {
      getDb().insert(aiSettings).values({ id: AI_SETTINGS_ID, data: json, updatedAt: now }).run()
    }
    return true
  })

  // 「任务默认模型参数」的任务注册表（key / 名称 / 说明 / 内置默认温度）。
  // 注册表由后端维护（electron/utils/sampling.ts），渲染层只做展示，避免两处数据源漂移。
  // 任务的具体配置值存在 ai_settings.data.taskSampling 里，仍走上面的 get/saveAiSettings。
  ipcMain.handle('settings:getSamplingTasks', async () => SAMPLING_TASKS)

  ipcMain.handle('settings:clearModels', async () => {
    deleteAll(modelProviders)
    return true
  })

  ipcMain.handle('settings:clearApplyLogs', async () => {
    deleteAll(applyLogs)
    return true
  })

  ipcMain.handle('settings:clearChatMessages', async () => {
    deleteAll(aiChatMessages)
    return true
  })

  // 清空「剧情预演」全部数据（房间 / Run / 片段 / 角色模型偏好），跨所有书。
  // 子表先于父表删除，避免外键约束（即便 foreign_keys 开启也安全）。
  ipcMain.handle('settings:clearRoleDialogue', async () => {
    const db = getDb()
    db.delete(roleDialogueSnippets).run()
    db.delete(roleDialogueRuns).run()
    db.delete(roleDialogueCharacterModels).run()
    db.delete(roleDialogueRooms).run()
    return true
  })

  // 清空「角色聊天室」全部数据（房间 / 在场角色 / 消息 / 角色模型偏好），跨所有书。
  ipcMain.handle('settings:clearChatRoom', async () => {
    const db = getDb()
    db.delete(chatRoomMessages).run()
    db.delete(chatRoomParticipants).run()
    db.delete(chatRoomCharacterModels).run()
    db.delete(chatRoomRooms).run()
    return true
  })

  ipcMain.handle('settings:clearTokens', async () => {
    deleteAll(tokenUsageLogs)
    return true
  })

  ipcMain.handle('settings:clearPromptCaches', async () => {
    deleteAll(promptCaches)
    deleteAll(contextCaches)
    clearPromptCacheMemo()
    return true
  })

  ipcMain.handle('settings:clearAll', async () => {
    resetAllDatabase()
    clearPromptCacheMemo()
    return true
  })
}
