// 剧情预演 IPC 注册
//
// 暴露给渲染进程的 API（命名空间 roleDialogue.*）：
//   - 房间 CRUD：       listRooms / createRoom / updateRoom / deleteRoom
//   - Run CRUD：        listRuns / createRun / deleteRun / updateRunCharacters
//   - 片段 CRUD：       listSnippets / createSnippet / updateSnippet / deleteSnippet
//   - 片段重跑：        regenerateSnippet（把旧 messages 追加到 versions，新内容覆盖）
//   - 事实更新：        insertAuthorFact
//   - 作者旁白：        appendNarratorSnippet
//   - 角色合并：        listCharacters（从 bookSetting + bookMemory 合并去重）
//   - 角色 model 偏好： getCharacterModel / setCharacterModel
//   - 工具：            generateSnippet（跑一个片段的全部发言；见 role-dialogue/snippet-runner.ts）

import { ipcMain } from 'electron'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import {
  roleDialogueRooms,
  roleDialogueRuns,
  roleDialogueSnippets,
  roleDialogueCharacterModels,
  bookSettingEntries,
  bookMemory,
} from '../db/schema'
import type {
  CreateRoomInput,
  CreateRunInput,
  CreateSnippetInput,
  UpdateRoomInput,
  UpdateSnippetInput,
} from '../agent/role-dialogue/types'
import { generateSnippet } from '../agent/role-dialogue/snippet-runner'
import { generateSummary } from '../agent/role-dialogue/summary-runner'

function now() {
  return new Date().toISOString()
}

export function registerRoleDialogueIpc() {
  // ─── 房间 ─────────────────────────────────────────────
  ipcMain.handle('roleDialogue:listRooms', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(roleDialogueRooms)
      .where(eq(roleDialogueRooms.bookId, bookId))
      .orderBy(desc(roleDialogueRooms.updatedAt))
      .all()
  })

  ipcMain.handle('roleDialogue:createRoom', async (_, data: CreateRoomInput) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(roleDialogueRooms).values({
      id,
      bookId: data.bookId,
      title: data.title,
      situation: data.situation ?? '',
      chapterId: data.chapterId ?? null,
      defaultModelId: data.defaultModelId ?? null,
      injectWritingSettings: data.injectWritingSettings ?? true,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, id)).get()
  })

  ipcMain.handle('roleDialogue:updateRoom', async (_, id: string, data: UpdateRoomInput) => {
    const db = getDb()
    const update: Record<string, any> = { updatedAt: now() }
    if (data.title !== undefined) update.title = data.title
    if (data.situation !== undefined) update.situation = data.situation
    if (data.chapterId !== undefined) update.chapterId = data.chapterId
    if (data.defaultModelId !== undefined) update.defaultModelId = data.defaultModelId
    if (data.injectWritingSettings !== undefined) update.injectWritingSettings = data.injectWritingSettings
    db.update(roleDialogueRooms).set(update).where(eq(roleDialogueRooms.id, id)).run()
    return db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, id)).get()
  })

  ipcMain.handle('roleDialogue:deleteRoom', async (_, id: string) => {
    const db = getDb()
    // 外键级联会自动删 runs / snippets
    db.delete(roleDialogueRooms).where(eq(roleDialogueRooms.id, id)).run()
    return { success: true }
  })

  // ─── 工具：把 DB row 的 JSON 字段解析回来 ─────────────────
/** 安全 JSON 解析（带兜底） */
function safeParseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  if (typeof text === 'object') return text as any
  try { return JSON.parse(text) as T } catch { return fallback }
}

/** 把 snippet row 里的 JSON 字段解析为前端期望的类型 */
function parseSnippetRow(row: any) {
  if (!row) return row
  return {
    ...row,
    characterIds: safeParseJson<any[]>(row.characterIds, []),
    messages: safeParseJson<any[]>(row.messages, []),
    versions: safeParseJson<any[]>(row.versions, []),
    authorFactUpdate: row.authorFactUpdate
      ? safeParseJson<{ fact: string; insertedAt: string }>(row.authorFactUpdate, null as any)
      : null,
    kind: (row.kind as 'snippet' | 'summary') || 'snippet',
    summaryView: (row.summaryView as 'first-person' | 'third-person' | null) ?? null,
    summaryViewCharacterId: row.summaryViewCharacterId ?? null,
    summaryCoveredSnippetIds: safeParseJson<string[]>(row.summaryCoveredSnippetIds, []),
  }
}

/** 把 run row 里的 JSON 字段解析为前端期望的类型 */
function parseRunRow(row: any) {
  if (!row) return row
  return {
    ...row,
    characterIdsSnapshot: safeParseJson<any[]>(row.characterIdsSnapshot, []),
  }
}

// ─── Run ──────────────────────────────────────────────
  ipcMain.handle('roleDialogue:listRuns', async (_, roomId: string) => {
    const db = getDb()
    return db.select().from(roleDialogueRuns)
      .where(eq(roleDialogueRuns.roomId, roomId))
      .orderBy(asc(roleDialogueRuns.runNumber))
      .all()
      .map(parseRunRow)
  })

  ipcMain.handle('roleDialogue:createRun', async (_, data: CreateRunInput) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    // 计算该房间下一个 runNumber
    const last = db.select({ runNumber: roleDialogueRuns.runNumber })
      .from(roleDialogueRuns)
      .where(eq(roleDialogueRuns.roomId, data.roomId))
      .orderBy(desc(roleDialogueRuns.runNumber))
      .limit(1)
      .get()
    const runNumber = (last?.runNumber ?? 0) + 1
    db.insert(roleDialogueRuns).values({
      id,
      roomId: data.roomId,
      runNumber,
      characterIdsSnapshot: JSON.stringify(data.characterIds),
      status: 'idle',
      createdAt: ts,
    }).run()
    return parseRunRow(db.select().from(roleDialogueRuns).where(eq(roleDialogueRuns.id, id)).get())
  })

  ipcMain.handle('roleDialogue:deleteRun', async (_, id: string) => {
    const db = getDb()
    db.delete(roleDialogueRuns).where(eq(roleDialogueRuns.id, id)).run()
    return { success: true }
  })

  // 更新 Run 的"在场角色"列表（每片段可改）—— 改的是 characterIdsSnapshot
  ipcMain.handle('roleDialogue:updateRunCharacters', async (_, runId: string, characterIds: string[]) => {
    const db = getDb()
    db.update(roleDialogueRuns)
      .set({ characterIdsSnapshot: JSON.stringify(characterIds) })
      .where(eq(roleDialogueRuns.id, runId))
      .run()
    return parseRunRow(db.select().from(roleDialogueRuns).where(eq(roleDialogueRuns.id, runId)).get())
  })

  // ─── 片段 ─────────────────────────────────────────────
  ipcMain.handle('roleDialogue:listSnippets', async (_, runId: string) => {
    const db = getDb()
    const rows = db.select().from(roleDialogueSnippets)
      .where(eq(roleDialogueSnippets.runId, runId))
      .orderBy(asc(roleDialogueSnippets.order))
      .all()
    // 把存为字符串的 JSON 字段解析回对象，方便渲染进程直接用
    return rows.map((r) => ({
      ...r,
      characterIds: safeParse(r.characterIds, []),
      messages: safeParse(r.messages, []),
      versions: safeParse(r.versions, []),
      authorFactUpdate: r.authorFactUpdate ? safeParse(r.authorFactUpdate, null) : null,
      kind: (r.kind as 'snippet' | 'summary') || 'snippet',
      summaryView: (r.summaryView as 'first-person' | 'third-person' | null) ?? null,
      summaryViewCharacterId: r.summaryViewCharacterId ?? null,
      summaryCoveredSnippetIds: safeParse(r.summaryCoveredSnippetIds, []),
    }))
  })

  ipcMain.handle('roleDialogue:createSnippet', async (_, data: CreateSnippetInput) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(roleDialogueSnippets).values({
      id,
      runId: data.runId,
      order: data.order,
      characterIds: JSON.stringify(data.characterIds),
      messages: JSON.stringify(data.messages),
      versions: '[]',
      regenerateCount: 0,
      authorFactUpdate: data.authorFactUpdate ? JSON.stringify(data.authorFactUpdate) : null,
      kind: 'snippet',
      summaryView: null,
      summaryViewCharacterId: null,
      summaryCoveredSnippetIds: '[]',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return parseSnippetRow(db.select().from(roleDialogueSnippets).where(eq(roleDialogueSnippets.id, id)).get())
  })

  ipcMain.handle('roleDialogue:updateSnippet', async (_, id: string, data: UpdateSnippetInput) => {
    const db = getDb()
    const update: Record<string, any> = { updatedAt: now() }
    if (data.messages !== undefined) update.messages = JSON.stringify(data.messages)
    if (data.authorFactUpdate !== undefined) {
      update.authorFactUpdate = data.authorFactUpdate ? JSON.stringify(data.authorFactUpdate) : null
    }
    db.update(roleDialogueSnippets).set(update).where(eq(roleDialogueSnippets.id, id)).run()
    return { success: true }
  })

  ipcMain.handle('roleDialogue:regenerateSnippet', async (_, id: string, newMessages: any[]) => {
    const db = getDb()
    const existing = db.select().from(roleDialogueSnippets).where(eq(roleDialogueSnippets.id, id)).get()
    if (!existing) throw new Error('片段不存在')
    const oldMessages = safeParse(existing.messages, [])
    const oldVersions = safeParse(existing.versions, [])
    const newVersions = [
      ...oldVersions,
      { messages: oldMessages, regeneratedAt: now() },
    ]
    const ts = now()
    db.update(roleDialogueSnippets).set({
      messages: JSON.stringify(newMessages),
      versions: JSON.stringify(newVersions),
      regenerateCount: (existing.regenerateCount ?? 0) + 1,
      updatedAt: ts,
    }).where(eq(roleDialogueSnippets.id, id)).run()
    return { success: true }
  })

  ipcMain.handle('roleDialogue:insertAuthorFact', async (_, id: string, fact: string) => {
    const db = getDb()
    const ts = now()
    db.update(roleDialogueSnippets).set({
      authorFactUpdate: JSON.stringify({ fact, insertedAt: ts }),
      updatedAt: ts,
    }).where(eq(roleDialogueSnippets.id, id)).run()
    return { success: true }
  })

  ipcMain.handle('roleDialogue:deleteSnippet', async (_, id: string) => {
    const db = getDb()
    // 事务：删除本片段及之后所有片段（保持时间线连续）
    const target = db.select().from(roleDialogueSnippets)
      .where(eq(roleDialogueSnippets.id, id)).get()
    if (!target) return { success: true, deletedCount: 0 }
    const all = db.select({ id: roleDialogueSnippets.id, order: roleDialogueSnippets.order })
      .from(roleDialogueSnippets)
      .where(eq(roleDialogueSnippets.runId, target.runId))
      .orderBy(asc(roleDialogueSnippets.order))
      .all()
    const toDelete = all.filter((s) => s.order >= target.order)
    const ids = toDelete.map((s) => s.id)
    if (ids.length > 0) {
      db.delete(roleDialogueSnippets).where(inArray(roleDialogueSnippets.id, ids)).run()
    }
    return { success: true, deletedCount: ids.length }
  })

  // ─── 角色合并（bookSetting + bookMemory） ────────────────────
  // 用于「剧情预演」选角色 / 右侧角色面板：
  //   - 数据源 1：bookSettingEntries(type='characters') —— 设定里登记的角色
  //   - 数据源 2：bookMemory.data.characters[] —— 记忆/记忆线里的角色
  //   - 去重规则：先按 id 严格匹配，再按 name 模糊匹配
  //     （normalizeName：去空格/标点/大小写后相等视为同一人）
  //   - 合并策略：记忆优先（记忆字段覆盖设定，null/空字段保留设定值）
  //   - 临时人物：记忆里有但设定里没的，也算角色
  ipcMain.handle('roleDialogue:listCharacters', async (_, bookId: string) => {
    const db = getDb()
    const normalizeName = (n: string) =>
      String(n || '').replace(/[\s:：》《<>「」『』【】\-—_]/g, '').toLowerCase().trim()

    // 1) 拉设定角色
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

    // 2) 拉记忆角色
    const memRow = db.select({ data: bookMemory.data })
      .from(bookMemory)
      .where(eq(bookMemory.bookId, bookId))
      .get()
    let memoryChars: any[] = []
    if (memRow?.data) {
      try {
        const parsed = JSON.parse(memRow.data)
        if (Array.isArray(parsed?.characters)) memoryChars = parsed.characters
      } catch {}
    }

    // 3) 合并：先用设定初始化，再让记忆覆盖 / 补充
    type MergedChar = {
      id: string
      name: string
      description: string
      detail: string
      currentState?: string
      location?: string
      status?: string
      source: 'setting' | 'memory' | 'merged'
    }
    const byId = new Map<string, MergedChar>()
    const byNameNorm = new Map<string, MergedChar>()
    const addOrMerge = (m: MergedChar) => {
      byId.set(m.id, m)
      byNameNorm.set(normalizeName(m.name), m)
    }

    // 先放设定角色
    for (const r of settingRows) {
      const m: MergedChar = {
        id: r.id,
        name: r.name,
        description: r.description || '',
        detail: r.detail || '',
        source: 'setting',
      }
      addOrMerge(m)
    }

    // 再用记忆角色合并/覆盖/新增
    for (const c of memoryChars || []) {
      const name = String(c?.name || '').trim()
      if (!name) continue
      const norm = normalizeName(name)
      // 找匹配
      const byIdHit = c?.id ? byId.get(String(c.id)) : undefined
      const byNameHit = byNameNorm.get(norm)
      const target = byIdHit || byNameHit
      if (target) {
        // 合并：记忆优先，但记忆里空字段保留设定
        if (c?.id && !byIdHit) {
          // 用记忆里的 id 替换（如果设定里没记录这个 id）
          byId.delete(target.id)
          target.id = String(c.id)
          addOrMerge(target)
        }
        if (c?.name) target.name = name
        if (c?.description) target.description = String(c.description)
        if (c?.detail) target.detail = String(c.detail)
        if (c?.currentState) target.currentState = String(c.currentState)
        if (c?.location) target.location = String(c.location)
        if (c?.status) target.status = String(c.status)
        target.source = 'merged'
      } else {
        // 临时人物：直接加入
        const m: MergedChar = {
          id: c?.id ? String(c.id) : `mem_${uuidv4()}`,
          name,
          description: c?.description ? String(c.description) : '',
          detail: c?.detail ? String(c.detail) : '',
          currentState: c?.currentState
            ? (typeof c.currentState === 'object' ? c.currentState : String(c.currentState))
            : undefined,
          location: c?.location
            ? (typeof c.location === 'object' ? c.location : String(c.location))
            : undefined,
          status: c?.status ? String(c.status) : undefined,
          source: 'memory',
        }
        addOrMerge(m)
      }
    }

    return Array.from(byId.values())
  })

  // ─── 角色 model 偏好 ──────────────────────────────────
  ipcMain.handle('roleDialogue:getCharacterModel', async (_, bookId: string, characterId: string) => {
    const db = getDb()
    return db.select().from(roleDialogueCharacterModels)
      .where(and(
        eq(roleDialogueCharacterModels.bookId, bookId),
        eq(roleDialogueCharacterModels.characterId, characterId),
      ))
      .get() ?? null
  })

  ipcMain.handle('roleDialogue:setCharacterModel', async (_, bookId: string, characterId: string, modelId: string | null) => {
    const db = getDb()
    const ts = now()
    if (!modelId) {
      // 删除偏好 → 回退到房间/知卷默认
      db.delete(roleDialogueCharacterModels)
        .where(and(
          eq(roleDialogueCharacterModels.bookId, bookId),
          eq(roleDialogueCharacterModels.characterId, characterId),
        ))
        .run()
      return { success: true, cleared: true }
    }
    const existing = db.select().from(roleDialogueCharacterModels)
      .where(and(
        eq(roleDialogueCharacterModels.bookId, bookId),
        eq(roleDialogueCharacterModels.characterId, characterId),
      ))
      .get()
    if (existing) {
      db.update(roleDialogueCharacterModels)
        .set({ modelId, updatedAt: ts })
        .where(eq(roleDialogueCharacterModels.id, existing.id))
        .run()
      return { id: existing.id, modelId }
    }
    const id = uuidv4()
    db.insert(roleDialogueCharacterModels).values({
      id, bookId, characterId, modelId, createdAt: ts, updatedAt: ts,
    }).run()
    return { id, modelId }
  })

  // ─── 工具：生成一个片段的全部角色发言 ───────────────────
  // 渲染进程传入：runId, characterIds, chapterId（可选，来自房间的快照）
  // 返回：messages[] 数组（按角色顺序），可直接 createSnippet / regenerateSnippet
  // 注：实际生成可能会很慢（多次模型调用），这里不发送流式事件——只返回最终结果。
  // UI 在调用期间展示 loading 状态即可。
  ipcMain.handle('roleDialogue:appendNarratorSnippet', async (_, runId: string, narratorText: string) => {
    const db = getDb()
    const ts = now()
    // 计算下一个 order
    const last = db.select({ order: roleDialogueSnippets.order })
      .from(roleDialogueSnippets)
      .where(eq(roleDialogueSnippets.runId, runId))
      .orderBy(desc(roleDialogueSnippets.order))
      .limit(1)
      .get()
    const order = (last?.order ?? 0) + 1
    const id = uuidv4()
    // 旁白 = 一个独立片段，characterIds 用 '__narrator__' 标识
    db.insert(roleDialogueSnippets).values({
      id,
      runId,
      order,
      characterIds: JSON.stringify(['__narrator__']),
      messages: JSON.stringify([{
        characterId: '__narrator__',
        characterName: '作者旁白',
        publicContent: narratorText,
        innerThought: '',
        modelId: null,
      }]),
      versions: '[]',
      regenerateCount: 0,
      authorFactUpdate: null,
      kind: 'snippet',
      summaryView: null,
      summaryViewCharacterId: null,
      summaryCoveredSnippetIds: '[]',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return parseSnippetRow(db.select().from(roleDialogueSnippets).where(eq(roleDialogueSnippets.id, id)).get())
  })

  ipcMain.handle('roleDialogue:generateSnippet', async (_, data: {
    runId: string
    characterIds: string[]
    authorFact?: string | null
    agentFallbackModelId?: string | null
  }) => {
    return generateSnippet({
      runId: data.runId,
      characterIds: data.characterIds,
      authorFact: data.authorFact ?? null,
      agentFallbackModelId: data.agentFallbackModelId ?? null,
    })
  })

  // ─── 总结片段：把上次 summary 之后的所有 snippet 压缩成一段完整剧情 ───
  // 视角选择：
  //   - first-person：选择某个角色作为"我"的第一人称总结
  //   - third-person：第三方旁白群像视角
  // 范围：增量（找到最近一条 summary，从它之后到当前的所有 snippet 参与总结）；
  //       没有 summary 时从第一个 snippet 开始。
  // 后续生成时：context-builder 会自动从最近 summary 开始拼接，之前的片段不再注入。
  ipcMain.handle('roleDialogue:generateSummary', async (_, data: {
    runId: string
    view: 'first-person' | 'third-person'
    viewCharacterId?: string | null
    agentFallbackModelId?: string | null
    sourceSummaryId?: string | null
  }) => {
    return generateSummary({
      runId: data.runId,
      view: data.view,
      viewCharacterId: data.viewCharacterId ?? null,
      agentFallbackModelId: data.agentFallbackModelId ?? null,
      sourceSummaryId: data.sourceSummaryId ?? null,
    })
  })
}

function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try { return JSON.parse(text) as T } catch { return fallback }
}
