// 角色聊天室 IPC 注册
//
// 暴露给渲染进程的 API（命名空间 chatRoom.*）：
//   - 房间 CRUD：       listRooms / createRoom / updateRoom / deleteRoom
//   - 在场角色：        listParticipants / addParticipant / removeParticipant / reorderParticipants
//   - 消息：            listMessages / clearMessages / deleteMessage
//   - 选角色（本书）：  listCharacters（bookSetting + bookMemory 合并去重，独立实现）
//   - 角色 model 偏好： getCharacterModel / setCharacterModel
//   - 生成：            sendTurn（跑一个回合：落库用户消息 + 在场角色依次接龙；逐字流式事件见 chat-runner.ts）

import { ipcMain } from 'electron'
import { and, asc, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import {
  bookMemory,
  bookSettingEntries,
  chatRoomCharacterModels,
  chatRoomMessages,
  chatRoomParticipants,
  chatRoomRooms,
} from '../db/schema'
import type {
  CreateChatRoomInput,
  UpdateChatRoomInput,
  SendTurnInput,
} from '../agent/chat-room/types'
import { sendTurn, characterSpeak } from '../agent/chat-room/chat-runner'
import { getAllCharacterMemoryStates } from '../agent/chat-room/memory-states'

function now() {
  return new Date().toISOString()
}

export function registerChatRoomIpc() {
  // ─── 房间 ─────────────────────────────────────────────
  ipcMain.handle('chatRoom:listRooms', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(chatRoomRooms)
      .where(eq(chatRoomRooms.bookId, bookId))
      .orderBy(desc(chatRoomRooms.updatedAt))
      .all()
  })

  ipcMain.handle('chatRoom:createRoom', async (_, data: CreateChatRoomInput) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(chatRoomRooms).values({
      id,
      bookId: data.bookId,
      title: data.title,
      defaultModelId: data.defaultModelId ?? null,
      speakingMode: data.speakingMode ?? 'sequential',
      historyLimit: data.historyLimit ?? 50,
      displayLimit: data.displayLimit ?? 15,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, id)).get()
  })

  ipcMain.handle('chatRoom:updateRoom', async (_, id: string, data: UpdateChatRoomInput) => {
    const db = getDb()
    const update: Record<string, any> = { updatedAt: now() }
    if (data.title !== undefined) update.title = data.title
    if (data.defaultModelId !== undefined) update.defaultModelId = data.defaultModelId
    if (data.speakingMode !== undefined) update.speakingMode = data.speakingMode
    if (data.historyLimit !== undefined) update.historyLimit = data.historyLimit
    if (data.displayLimit !== undefined) update.displayLimit = data.displayLimit
    db.update(chatRoomRooms).set(update).where(eq(chatRoomRooms.id, id)).run()
    return db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, id)).get()
  })

  ipcMain.handle('chatRoom:deleteRoom', async (_, id: string) => {
    const db = getDb()
    // 外键级联会自动删 participants / messages / character_models
    db.delete(chatRoomRooms).where(eq(chatRoomRooms.id, id)).run()
    return { success: true }
  })

  // ─── 在场角色 ─────────────────────────────────────────
  ipcMain.handle('chatRoom:listParticipants', async (_, roomId: string) => {
    const db = getDb()
    const ret = db.select().from(chatRoomParticipants)
      .where(eq(chatRoomParticipants.roomId, roomId))
      .orderBy(asc(chatRoomParticipants.sortOrder))
      .all()
    console.log('[chatRoom IPC] listParticipants roomId=', roomId, 'ids:', ret.map((r) => r.id), 'sortOrders:', ret.map((r) => r.sortOrder))
    return ret
  })

  // 把角色加入在场列表（按 characterId 去重；已在则不重复加）
  ipcMain.handle('chatRoom:addParticipant', async (_, roomId: string, characterId: string) => {
    const db = getDb()
    const existing = db.select().from(chatRoomParticipants)
      .where(and(
        eq(chatRoomParticipants.roomId, roomId),
        eq(chatRoomParticipants.characterId, characterId),
      )).get()
    if (existing) return existing
    // 取角色名（bookSettingEntries 优先，缺失回退 bookMemory）
    const room = db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, roomId)).get()
    let characterName = ''
    const settingRow = db.select().from(bookSettingEntries).where(eq(bookSettingEntries.id, characterId)).get()
    if (settingRow) {
      characterName = settingRow.name
    } else if (room) {
      const memRow = db.select({ data: bookMemory.data }).from(bookMemory).where(eq(bookMemory.bookId, room.bookId)).get()
      if (memRow?.data) {
        try {
          const parsed = JSON.parse(memRow.data)
          const chars: any[] = Array.isArray(parsed?.characters) ? parsed.characters : []
          const hit = chars.find((c) => String(c?.id) === characterId)
          if (hit) characterName = hit.name || ''
        } catch {}
      }
    }
    const last = db.select({ sortOrder: chatRoomParticipants.sortOrder })
      .from(chatRoomParticipants)
      .where(eq(chatRoomParticipants.roomId, roomId))
      .orderBy(desc(chatRoomParticipants.sortOrder))
      .limit(1).get()
    const sortOrder = (last?.sortOrder ?? 0) + 1
    const id = uuidv4()
    db.insert(chatRoomParticipants).values({
      id, roomId, characterId, characterName, sortOrder, createdAt: now(),
    }).run()
    return db.select().from(chatRoomParticipants).where(eq(chatRoomParticipants.id, id)).get()
  })

  ipcMain.handle('chatRoom:removeParticipant', async (_, id: string) => {
    const db = getDb()
    db.delete(chatRoomParticipants).where(eq(chatRoomParticipants.id, id)).run()
    return { success: true }
  })

  // 拖拽排序后整体重排：orderedIds 为新的完整顺序（participant id 列表）
  ipcMain.handle('chatRoom:reorderParticipants', async (_, roomId: string, orderedIds: string[]) => {
    console.log('[chatRoom IPC] reorderParticipants roomId=', roomId, 'orderedIds=', orderedIds)
    const db = getDb()
    // 用事务保证原子性 + 性能提升
    db.transaction((tx) => {
      orderedIds.forEach((pid, idx) => {
        tx.update(chatRoomParticipants)
          .set({ sortOrder: idx + 1 })
          .where(and(
            eq(chatRoomParticipants.id, pid),
            eq(chatRoomParticipants.roomId, roomId),
          )).run()
      })
    })
    const ret = db.select().from(chatRoomParticipants)
      .where(eq(chatRoomParticipants.roomId, roomId))
      .orderBy(asc(chatRoomParticipants.sortOrder))
      .all()
    console.log('[chatRoom IPC] reorderParticipants result ids:', ret.map((r) => r.id), 'sortOrders:', ret.map((r) => r.sortOrder))
    return ret
  })

  // ─── 消息 ─────────────────────────────────────────────
  ipcMain.handle('chatRoom:listMessages', async (_, roomId: string) => {
    const db = getDb()
    const rows = db.select().from(chatRoomMessages)
      .where(eq(chatRoomMessages.roomId, roomId))
      .orderBy(chatRoomMessages.order as any)
      .all()
    // usage 列是 JSON 字符串，解析成对象返回（与 serializeMessage / 前端类型一致）
    return rows.map((r) => {
      let usage: any = null
      if (r.usage) {
        try { usage = JSON.parse(r.usage) } catch {}
      }
      return { ...r, usage }
    })
  })

  // 一键清空聊天记录（保留房间与在场角色）
  ipcMain.handle('chatRoom:clearMessages', async (_, roomId: string) => {
    const db = getDb()
    db.delete(chatRoomMessages).where(eq(chatRoomMessages.roomId, roomId)).run()
    return { success: true, deleted: true }
  })

  ipcMain.handle('chatRoom:deleteMessage', async (_, id: string) => {
    const db = getDb()
    db.delete(chatRoomMessages).where(eq(chatRoomMessages.id, id)).run()
    return { success: true }
  })

  // ─── 角色定稿记忆状态（右侧面板「最近的状态」数据来源） ───
  // 解析逻辑统一复用 ../agent/chat-room/memory-states（与注入 LLM 上下文同源，保证一致）
  ipcMain.handle('chatRoom:getCharacterMemoryStates', async (_, bookId: string, characterIds: string[]) => {
    const states = getAllCharacterMemoryStates(bookId, characterIds)
    const result: Record<string, string> = {}
    for (const s of states) result[s.characterId] = s.stateText
    return result
  })

  // ─── 选角色（本书，bookSetting + bookMemory 合并去重） ───
  ipcMain.handle('chatRoom:listCharacters', async (_, bookId: string) => {
    const db = getDb()
    const normalizeName = (n: string) =>
      String(n || '').replace(/[\s:：》《<>「」『』【】\-—_]/g, '').toLowerCase().trim()

    const settingRows = db.select({
      id: bookSettingEntries.id,
      name: bookSettingEntries.name,
      description: bookSettingEntries.description,
      detail: bookSettingEntries.detail,
    })
      .from(bookSettingEntries)
      .where(and(
        eq(bookSettingEntries.bookId, bookId),
        eq(bookSettingEntries.type, 'characters'),
      ))
      .all()

    const memRow = db.select({ data: bookMemory.data })
      .from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()
    let memoryChars: any[] = []
    if (memRow?.data) {
      try {
        const parsed = JSON.parse(memRow.data)
        if (Array.isArray(parsed?.characters)) memoryChars = parsed.characters
      } catch {}
    }

    type MergedChar = {
      id: string; name: string; description: string; detail: string; source: 'setting' | 'memory' | 'merged'
    }
    const byId = new Map<string, MergedChar>()
    const byNameNorm = new Map<string, MergedChar>()
    const addOrMerge = (m: MergedChar) => { byId.set(m.id, m); byNameNorm.set(normalizeName(m.name), m) }

    for (const r of settingRows) {
      addOrMerge({ id: r.id, name: r.name, description: r.description || '', detail: r.detail || '', source: 'setting' })
    }
    for (const c of memoryChars || []) {
      const name = String(c?.name || '').trim()
      if (!name) continue
      const norm = normalizeName(name)
      const byIdHit = c?.id ? byId.get(String(c.id)) : undefined
      const byNameHit = byNameNorm.get(norm)
      const target = byIdHit || byNameHit
      if (target) {
        if (c?.id && !byIdHit) { byId.delete(target.id); target.id = String(c.id); addOrMerge(target) }
        if (c?.name) target.name = name
        if (c?.description) target.description = String(c.description)
        if (c?.detail) target.detail = String(c.detail)
        target.source = 'merged'
      } else {
        addOrMerge({
          id: c?.id ? String(c.id) : `mem_${uuidv4()}`,
          name,
          description: c?.description ? String(c.description) : '',
          detail: c?.detail ? String(c.detail) : '',
          source: 'memory',
        })
      }
    }
    return Array.from(byId.values())
  })

  // ─── 角色 model 偏好（chat_room_character_models） ───
  ipcMain.handle('chatRoom:getCharacterModel', async (_, bookId: string, characterId: string) => {
    const db = getDb()
    return db.select().from(chatRoomCharacterModels)
      .where(and(
        eq(chatRoomCharacterModels.bookId, bookId),
        eq(chatRoomCharacterModels.characterId, characterId),
      ))
      .get() ?? null
  })

  ipcMain.handle('chatRoom:setCharacterModel', async (_, bookId: string, characterId: string, modelId: string | null) => {
    const db = getDb()
    const ts = now()
    if (!modelId) {
      db.delete(chatRoomCharacterModels)
        .where(and(
          eq(chatRoomCharacterModels.bookId, bookId),
          eq(chatRoomCharacterModels.characterId, characterId),
        )).run()
      return { success: true, cleared: true }
    }
    const existing = db.select().from(chatRoomCharacterModels)
      .where(and(
        eq(chatRoomCharacterModels.bookId, bookId),
        eq(chatRoomCharacterModels.characterId, characterId),
      )).get()
    if (existing) {
      db.update(chatRoomCharacterModels)
        .set({ modelId, updatedAt: ts })
        .where(eq(chatRoomCharacterModels.id, existing.id)).run()
      return { id: existing.id, modelId }
    }
    const id = uuidv4()
    db.insert(chatRoomCharacterModels).values({
      id, bookId, characterId, modelId, createdAt: ts, updatedAt: ts,
    }).run()
    return { id, modelId }
  })

  // ─── 生成（一个回合） ─────────────────────────────────
  ipcMain.handle('chatRoom:sendTurn', async (_, data: SendTurnInput) => {
    return sendTurn({
      roomId: data.roomId,
      userContent: data.userContent ?? '',
      sender: data.sender ?? { role: 'director' },
      agentFallbackModelId: data.agentFallbackModelId ?? null,
    })
  })

  // 让单个在场角色单独说一句（角色卡片「发言」按钮触发）
  ipcMain.handle('chatRoom:characterSpeak', async (_, roomId: string, characterId: string) => {
    return characterSpeak(roomId, characterId)
  })
}
