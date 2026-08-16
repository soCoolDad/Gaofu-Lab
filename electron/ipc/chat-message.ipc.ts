import { ipcMain } from 'electron'
import { getDb, getSqlite } from '../db'
import { aiChatMessages } from '../db/schema'
import { asc, eq } from 'drizzle-orm'

// 前端消息体（与 aiChat.store.ts 的 AiChatMessage 对齐）
type ChatMessageInput = {
  id: string
  role: 'user' | 'ai'
  content: string
  rawContent?: string
  displayContent?: string
  usage?: any
  structuredData?: any
  contextType?: string
  chapterId?: string | null
  volumeId?: string | null
  canApply?: boolean
  contextSnapshot?: any
  cacheUsage?: any
  generatedResult?: any
  deletePlan?: any
  agentPlan?: any
  agentProgress?: any
  actualContextResources?: any
  contextGroups?: any
  awaitingPlanConfirmation?: boolean
  planStepResults?: any
  planRequest?: any
  stopped?: boolean
  /** AI 消息：模型是否调用过 mark_resume_after_apply（应用完自动续跑） */
  resumeAfterApply?: boolean
  /** 用户消息：是否由前端"自动续跑"机制发出 */
  autoResumed?: boolean
}

function toJson(value: any): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function fromJson<T = any>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function rowToMessage(row: any): ChatMessageInput {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    rawContent: row.rawContent ?? row.raw_content ?? undefined,
    displayContent: row.displayContent ?? row.display_content ?? undefined,
    usage: fromJson(row.usage),
    structuredData: fromJson(row.structuredData ?? row.structured_data),
    contextType: row.contextType ?? row.context_type ?? undefined,
    chapterId: row.chapterId ?? row.chapter_id ?? null,
    volumeId: row.volumeId ?? row.volume_id ?? null,
    canApply: !!(row.canApply ?? row.can_apply),
    contextSnapshot: fromJson(row.contextSnapshot ?? row.context_snapshot),
    cacheUsage: fromJson(row.cacheUsage ?? row.cache_usage),
    generatedResult: fromJson(row.generatedResult ?? row.generated_result),
    deletePlan: fromJson(row.deletePlan ?? row.delete_plan),
    agentPlan: fromJson(row.agentPlan ?? row.agent_plan),
    agentProgress: fromJson(row.agentProgress ?? row.agent_progress),
    actualContextResources: fromJson(row.actualContextResources ?? row.actual_context_resources),
    contextGroups: fromJson(row.contextGroups ?? row.context_groups),
    awaitingPlanConfirmation: !!(row.awaitingPlanConfirmation ?? row.awaiting_plan_confirmation),
    planStepResults: fromJson(row.planStepResults ?? row.plan_step_results),
    planRequest: fromJson(row.planRequest ?? row.plan_request),
    stopped: !!row.stopped,
    resumeAfterApply: !!(row.resumeAfterApply ?? row.resume_after_apply),
    autoResumed: !!(row.autoResumed ?? row.auto_resumed),
  }
}

export function registerChatMessageIpc() {
  // 查询某本书（或 global）的全部消息，按 sort_order 升序
  ipcMain.handle('chatMessage:list', async (_, bookId: string) => {
    const db = getDb()
    const rows = db.select().from(aiChatMessages).where(eq(aiChatMessages.bookId, bookId)).orderBy(asc(aiChatMessages.sortOrder)).all()
    return rows.map(rowToMessage)
  })

  // 批量写入（全量覆盖某 bookId 的消息）
  ipcMain.handle('chatMessage:saveBatch', async (_, data: { bookId: string; messages: ChatMessageInput[] }) => {
    const sqlite = getSqlite()
    const now = new Date().toISOString()
    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO ai_chat_messages (
        id, book_id, role, content, raw_content, display_content, usage,
        structured_data, context_type, chapter_id, volume_id, can_apply,
        context_snapshot, cache_usage, generated_result, delete_plan,
        agent_plan, agent_progress, actual_context_resources, context_groups,
        awaiting_plan_confirmation, plan_step_results, plan_request, stopped,
        resume_after_apply, auto_resumed,
        sort_order, created_at
      ) VALUES (
        @id, @book_id, @role, @content, @raw_content, @display_content, @usage,
        @structured_data, @context_type, @chapter_id, @volume_id, @can_apply,
        @context_snapshot, @cache_usage, @generated_result, @delete_plan,
        @agent_plan, @agent_progress, @actual_context_resources, @context_groups,
        @awaiting_plan_confirmation, @plan_step_results, @plan_request, @stopped,
        @resume_after_apply, @auto_resumed,
        @sort_order, @created_at
      )
    `)
    const deleteStmt = sqlite.prepare(`DELETE FROM ai_chat_messages WHERE book_id = ?`)

    sqlite.transaction(() => {
      deleteStmt.run(data.bookId)
      data.messages.forEach((msg, index) => {
        insertStmt.run({
          id: msg.id,
          book_id: data.bookId,
          role: msg.role,
          content: msg.content || '',
          raw_content: msg.rawContent || null,
          display_content: msg.displayContent || null,
          usage: toJson(msg.usage),
          structured_data: toJson(msg.structuredData),
          context_type: msg.contextType || null,
          chapter_id: msg.chapterId || null,
          volume_id: msg.volumeId || null,
          can_apply: msg.canApply ? 1 : 0,
          context_snapshot: toJson(msg.contextSnapshot),
          cache_usage: toJson(msg.cacheUsage),
          generated_result: toJson(msg.generatedResult),
          delete_plan: toJson(msg.deletePlan),
          agent_plan: toJson(msg.agentPlan),
          agent_progress: toJson(msg.agentProgress),
          actual_context_resources: toJson(msg.actualContextResources),
          context_groups: toJson(msg.contextGroups),
          awaiting_plan_confirmation: msg.awaitingPlanConfirmation ? 1 : 0,
          plan_step_results: toJson(msg.planStepResults),
          plan_request: toJson(msg.planRequest),
          stopped: msg.stopped ? 1 : 0,
          resume_after_apply: msg.resumeAfterApply ? 1 : 0,
          auto_resumed: msg.autoResumed ? 1 : 0,
          sort_order: index,
          created_at: now,
        })
      })
    })()
    return true
  })

  // 清空某 bookId 的消息
  ipcMain.handle('chatMessage:clear', async (_, bookId: string) => {
    const db = getDb()
    db.delete(aiChatMessages).where(eq(aiChatMessages.bookId, bookId)).run()
    return true
  })

  // 迁移消息：从 fromBookId 到 toBookId
  ipcMain.handle('chatMessage:move', async (_, data: { fromBookId: string; toBookId: string }) => {
    const sqlite = getSqlite()
    const sourceCount = sqlite.prepare(`SELECT COUNT(*) as count FROM ai_chat_messages WHERE book_id = ?`).get(data.fromBookId) as any
    if (!sourceCount || sourceCount.count === 0) return true

    sqlite.transaction(() => {
      // 获取目标现有消息数，作为迁移消息的起始 sort_order
      const targetCount = sqlite.prepare(`SELECT COUNT(*) as count FROM ai_chat_messages WHERE book_id = ?`).get(data.toBookId) as any
      const startOrder = targetCount?.count || 0

      // 更新 source 的 sort_order，然后迁移
      sqlite.prepare(`
        UPDATE ai_chat_messages
        SET book_id = ?, sort_order = sort_order + ?
        WHERE book_id = ?
      `).run(data.toBookId, startOrder, data.fromBookId)
    })()
    return true
  })

  /**
   * 按消息 id 列表迁移：把指定 id 的消息从任意来源桶搬到 toBookId 桶，其他消息不动。
   * 用于"链路裁剪迁移"：新建书后只把"本次立项相关"的消息搬到新书，更早的历史保留在原桶。
   */
  ipcMain.handle('chatMessage:moveByIds', async (_, data: { messageIds: string[]; toBookId: string }) => {
    const sqlite = getSqlite()
    if (!data.messageIds || data.messageIds.length === 0) return true

    sqlite.transaction(() => {
      // 目标现有消息数作为起始 sort_order，保持后来居上（追加到末尾）
      const targetCount = sqlite.prepare(`SELECT COUNT(*) as count FROM ai_chat_messages WHERE book_id = ?`).get(data.toBookId) as any
      let nextOrder = targetCount?.count || 0

      const updateStmt = sqlite.prepare(`
        UPDATE ai_chat_messages SET book_id = ?, sort_order = ? WHERE id = ?
      `)
      for (const msgId of data.messageIds) {
        updateStmt.run(data.toBookId, nextOrder, msgId)
        nextOrder += 1
      }
    })()
    return true
  })

  /**
   * 按消息 id 列表**复制**到 toBookId：源桶保留一份，目标桶得到一份副本（重新分配 id）。
   * 用于"新书立项 → 双端保留"：新书里得到完整立项上下文用于续写，
   * 原桶（global 或上一本书）保留原样，用户切回时仍能看到自己聊过的内容。
   * 副本消息的 id 前缀为 `copy_<newBookId前缀>_` + 时间戳 + 顺序号，保证全局唯一。
   *
   * 实现方式：用 `INSERT INTO ... SELECT` 复制所有列，只覆盖 id / book_id / sort_order 三列。
   * 这样即使表结构后续增删字段也无需改动此处代码。
   */
  ipcMain.handle('chatMessage:copyByIds', async (_, data: { messageIds: string[]; toBookId: string }) => {
    const sqlite = getSqlite()
    if (!data.messageIds || data.messageIds.length === 0) return true

    sqlite.transaction(() => {
      // 拿所有列名（除掉 id / book_id / sort_order，这三个由我们改写）
      const cols = sqlite.prepare(`PRAGMA table_info(ai_chat_messages)`).all() as Array<{ name: string }>
      const otherCols = cols.map((c) => c.name).filter((n) => n !== 'id' && n !== 'book_id' && n !== 'sort_order')
      const otherColsList = otherCols.map((n) => `"${n}"`).join(', ')

      const targetCount = sqlite.prepare(`SELECT COUNT(*) as count FROM ai_chat_messages WHERE book_id = ?`).get(data.toBookId) as any
      let nextOrder = targetCount?.count || 0
      const now = Date.now()
      const idPrefix = `copy_${data.toBookId.slice(0, 6)}_${now}_`

      const insertStmt = sqlite.prepare(`
        INSERT INTO ai_chat_messages (id, book_id, sort_order, ${otherColsList})
        SELECT ?, ?, ?, ${otherColsList} FROM ai_chat_messages WHERE id = ?
      `)
      let seq = 0
      for (const msgId of data.messageIds) {
        insertStmt.run(idPrefix + (seq++), data.toBookId, nextOrder++, msgId)
      }
    })()
    return true
  })

  // 清空全部聊天消息
  ipcMain.handle('chatMessage:clearAll', async () => {
    const db = getDb()
    db.delete(aiChatMessages).run()
    return true
  })

  // 按书籍 ID 删除（用于级联删除书籍时）
  ipcMain.handle('chatMessage:deleteByBook', async (_, bookId: string) => {
    const db = getDb()
    db.delete(aiChatMessages).where(eq(aiChatMessages.bookId, bookId)).run()
    return true
  })
}
