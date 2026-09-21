import { ipcMain } from 'electron'
import { getDb } from '../db'
import { applyLogs, bookMemory, bookMemoryVersions, books, chapters, chapterSnapshots, modelProviders, timelineClips, tokenUsageLogs, volumes } from '../db/schema'
import { and, asc, desc, eq, gt, gte, inArray, like, lte, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { now, todayStart, rangeStart, buildTokenLogWhere } from './ai.utils'
import type { TokenLogFilterData, TokenLogFacets } from './ai.types'
import { loadBookMemory } from '../agent/memory'
import { serializeBookMemory } from '../agent/memory/serializer'
import { resolveCurrentPrices } from '../utils/billing'

// ─── IPC 注册 ──────────────────────────────────────────────

export function registerAiIpc() {
  ipcMain.handle('ai:applyLogs', async (_, filter?: { bookId?: string | null; planId?: string | null; outcome?: 'success' | 'failed' | null; keyword?: string | null; limit?: number }) => {
    const db = getDb()
    const limit = Math.max(1, Math.min(1000, filter?.limit || 200))
    const conditions: any[] = []
    if (filter?.bookId) conditions.push(eq(applyLogs.bookId, filter.bookId))
    if (filter?.planId) conditions.push(eq(applyLogs.planId, filter.planId))
    if (filter?.outcome === 'success' || filter?.outcome === 'failed') {
      conditions.push(eq(applyLogs.outcome, filter.outcome))
    }
    const keyword = filter?.keyword?.trim()
    if (keyword) {
      conditions.push(like(applyLogs.targetSummary, `%${keyword}%`))
    }
    const query = conditions.length
      ? db.select().from(applyLogs).where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : db.select().from(applyLogs)
    return query.orderBy(desc(applyLogs.createdAt)).limit(limit).all()
  })

  ipcMain.handle('ai:exportApplyLogs', async (_, filter?: { bookId?: string | null; planId?: string | null; outcome?: 'success' | 'failed' | null; keyword?: string | null; limit?: number }) => {
    const db = getDb()
    const limit = Math.max(1, Math.min(10000, filter?.limit || 5000))
    const conditions: any[] = []
    if (filter?.bookId) conditions.push(eq(applyLogs.bookId, filter.bookId))
    if (filter?.planId) conditions.push(eq(applyLogs.planId, filter.planId))
    if (filter?.outcome === 'success' || filter?.outcome === 'failed') {
      conditions.push(eq(applyLogs.outcome, filter.outcome))
    }
    const keyword = filter?.keyword?.trim()
    if (keyword) {
      conditions.push(like(applyLogs.targetSummary, `%${keyword}%`))
    }
    const query = conditions.length
      ? db.select().from(applyLogs).where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : db.select().from(applyLogs)
    return query.orderBy(desc(applyLogs.createdAt)).limit(limit).all()
  })

  ipcMain.handle('ai:tokenLogs', async (_, filter?: TokenLogFilterData) => {
    const db = getDb()
    const data = filter || {}
    const where = buildTokenLogWhere(data)
    const page = Math.max(1, data.page || 1)
    const pageSize = Math.min(200, Math.max(1, data.pageSize || 15))
    const offset = (page - 1) * pageSize

    // 1) 筛选后的总条数
    const totalRow = db
      .select({ count: sql<number>`count(*)` })
      .from(tokenUsageLogs)
      .where(where)
      .get()
    const total = Number(totalRow?.count ?? 0)

    // 2) 当前页明细
    const rawItems = db
      .select({
        id: tokenUsageLogs.id,
        bookId: tokenUsageLogs.bookId,
        chapterId: tokenUsageLogs.chapterId,
        volumeId: tokenUsageLogs.volumeId,
        modelId: tokenUsageLogs.modelId,
        action: tokenUsageLogs.action,
        contextType: tokenUsageLogs.contextType,
        promptTokens: tokenUsageLogs.promptTokens,
        completionTokens: tokenUsageLogs.completionTokens,
        totalTokens: tokenUsageLogs.totalTokens,
        cachedPromptTokens: tokenUsageLogs.cachedPromptTokens,
        reasoningTokens: tokenUsageLogs.reasoningTokens,
        cost: tokenUsageLogs.cost,
        requestText: tokenUsageLogs.requestText,
        systemRequestText: tokenUsageLogs.systemRequestText,
        userRequestText: tokenUsageLogs.userRequestText,
        responseText: tokenUsageLogs.responseText,
        createdAt: tokenUsageLogs.createdAt,
        bookTitle: tokenUsageLogs.bookTitle,
        chapterTitle: chapters.title,
        volumeTitle: volumes.title,
        modelName: modelProviders.name,
        modelInputPrice: modelProviders.inputPrice,
        modelOutputPrice: modelProviders.outputPrice,
        modelCachedInputPrice: modelProviders.cachedInputPrice,
        modelBillingRules: modelProviders.billingRules,
      })
      .from(tokenUsageLogs)
      .leftJoin(books, eq(tokenUsageLogs.bookId, books.id))
      .leftJoin(chapters, eq(tokenUsageLogs.chapterId, chapters.id))
      .leftJoin(volumes, eq(tokenUsageLogs.volumeId, volumes.id))
      .leftJoin(modelProviders, eq(tokenUsageLogs.modelId, modelProviders.id))
      .where(where)
      .orderBy(desc(tokenUsageLogs.createdAt))
      .limit(pageSize)
      .offset(offset)
      .all()

    // 计费规则生效后的价格：按每条日志的 createdAt 回放当时的规则（避免"用今天的价格展示昨天的消耗"）。
    // 无规则 / 无规则命中 / 模型已删除（modelId 为 null）时回退到模型默认单价。
    const items = rawItems.map((row) => {
      const { prices: effective } = resolveCurrentPrices(
        {
          inputPrice: row.modelInputPrice,
          outputPrice: row.modelOutputPrice,
          cachedInputPrice: row.modelCachedInputPrice,
          billingRules: row.modelBillingRules ?? null,
        },
        row.createdAt ? new Date(row.createdAt) : new Date(),
      )
      return {
        ...row,
        modelInputPrice: effective.inputPrice,
        modelOutputPrice: effective.outputPrice,
        modelCachedInputPrice: effective.cachedInputPrice,
        modelBillingRules: undefined,
      }
    })

    // 3) 筛选后的汇总（覆盖全部匹配记录，而非仅当前页）
    const sumRow = db
      .select({
        promptTokens: sql<number>`sum(${tokenUsageLogs.promptTokens})`,
        completionTokens: sql<number>`sum(${tokenUsageLogs.completionTokens})`,
        totalTokens: sql<number>`sum(${tokenUsageLogs.totalTokens})`,
        cachedPromptTokens: sql<number>`sum(${tokenUsageLogs.cachedPromptTokens})`,
        reasoningTokens: sql<number>`sum(${tokenUsageLogs.reasoningTokens})`,
        cost: sql<number>`sum(${tokenUsageLogs.cost})`,
        calls: sql<number>`sum(${tokenUsageLogs.calls})`,
      })
      .from(tokenUsageLogs)
      .where(where)
      .get()

    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        promptTokens: Number(sumRow?.promptTokens ?? 0),
        completionTokens: Number(sumRow?.completionTokens ?? 0),
        totalTokens: Number(sumRow?.totalTokens ?? 0),
        cachedPromptTokens: Number(sumRow?.cachedPromptTokens ?? 0),
        reasoningTokens: Number(sumRow?.reasoningTokens ?? 0),
        cost: Number(sumRow?.cost ?? 0),
        // 调用次数：累计每次运行的模型调用轮数（一次聊天/写作含多轮），而非按记录行数
        calls: Number(sumRow?.calls ?? 0),
      },
    }
  })

  ipcMain.handle('ai:tokenLogFacets', async (): Promise<TokenLogFacets> => {
    const db = getDb()
    // 作品：书名优先取写入时的快照 book_title；老记录书名为空时回退取 books.title。
    // 仅当一条记录关联着作品（book_id 非空 或 书名快照非空）才计入，避免把全局对话也当成「作品」。
    const bookRows = db
      .select({
        snapshotTitle: tokenUsageLogs.bookTitle,
        bookId: tokenUsageLogs.bookId,
        bookTableTitle: books.title,
      })
      .from(tokenUsageLogs)
      .leftJoin(books, eq(tokenUsageLogs.bookId, books.id))
      .where(sql`${tokenUsageLogs.bookId} IS NOT NULL OR ${tokenUsageLogs.bookTitle} IS NOT NULL`)
      .all() as Array<{ snapshotTitle: string | null; bookId: string | null; bookTableTitle: string | null }>
    // 同书名可能在「未删除」与「已删除」下都存在 → 只要有一侧未删除就按未删除展示，
    // 仅当该书名下全部为已删除（book_id 全为 NULL）时才标记 deleted。
    const bookMap = new Map<string, boolean>()
    bookRows.forEach((r) => {
      const title = r.snapshotTitle || r.bookTableTitle
      if (!title) return
      const existing = bookMap.get(title)
      const isDeleted = r.bookId == null
      if (existing === undefined) bookMap.set(title, isDeleted)
      else if (!isDeleted) bookMap.set(title, false)
    })
    const booksFacet = Array.from(bookMap.entries())
      .map(([bookTitle, deleted]) => ({ bookTitle, deleted }))
      .sort((a, b) => a.bookTitle.localeCompare(b.bookTitle, 'zh-CN'))

    const modelRows = db
      .select({
        modelId: tokenUsageLogs.modelId,
        modelName: modelProviders.name,
        provider: modelProviders.provider,
      })
      .from(tokenUsageLogs)
      .leftJoin(modelProviders, eq(tokenUsageLogs.modelId, modelProviders.id))
      .where(sql`${tokenUsageLogs.modelId} IS NOT NULL`)
      .groupBy(tokenUsageLogs.modelId)
      .all() as Array<{ modelId: string; modelName: string | null; provider: string | null }>
    const modelsFacet = modelRows
      .map((r) => ({ modelId: r.modelId, modelName: r.modelName || '未知模型', provider: r.provider ?? null }))
      .sort((a, b) => a.modelName.localeCompare(b.modelName, 'zh-CN'))

    const actionRows = db
      .select({ action: tokenUsageLogs.action })
      .from(tokenUsageLogs)
      .where(sql`${tokenUsageLogs.action} IS NOT NULL AND ${tokenUsageLogs.action} != ''`)
      .all() as Array<{ action: string }>
    // action 列可能是组合字符串（如"创建章节 + 写作正文"），拆成单个动作标签后再去重，
    // 这样下拉能列出所有出现过的独立动作，而不是仅显示组合值。
    const actionSet = new Set<string>()
    actionRows.forEach((r) => {
      r.action.split(' + ').forEach((part) => {
        const label = part.trim()
        if (label) actionSet.add(label)
      })
    })
    const actionsFacet = Array.from(actionSet).sort((a, b) => a.localeCompare(b, 'zh-CN'))

    return { books: booksFacet, models: modelsFacet, actions: actionsFacet }
  })

  ipcMain.handle('ai:tokenSummary', async () => {
    const db = getDb()
    const today = todayStart()
    const todayRows = db.select().from(tokenUsageLogs).where(gte(tokenUsageLogs.createdAt, today)).all()
    const month = rangeStart('month')!
    const monthRows = db.select().from(tokenUsageLogs).where(gte(tokenUsageLogs.createdAt, month)).all()
    const byModel = db.select({
      modelId: tokenUsageLogs.modelId,
      modelName: modelProviders.name,
      totalTokens: sql<number>`sum(${tokenUsageLogs.totalTokens})`,
      promptTokens: sql<number>`sum(${tokenUsageLogs.promptTokens})`,
      completionTokens: sql<number>`sum(${tokenUsageLogs.completionTokens})`,
      cachedPromptTokens: sql<number>`sum(${tokenUsageLogs.cachedPromptTokens})`,
      reasoningTokens: sql<number>`sum(${tokenUsageLogs.reasoningTokens})`,
      cost: sql<number>`sum(${tokenUsageLogs.cost})`,
      inputPrice: modelProviders.inputPrice,
      outputPrice: modelProviders.outputPrice,
      cachedInputPrice: modelProviders.cachedInputPrice,
      billingRules: modelProviders.billingRules,
    })
      .from(tokenUsageLogs)
      .leftJoin(modelProviders, eq(tokenUsageLogs.modelId, modelProviders.id))
      .where(gte(tokenUsageLogs.createdAt, today))
      .groupBy(tokenUsageLogs.modelId)
      .all()

    // 侧边栏展示：每个模型今日的"聚合单价"取该模型今天最后一条日志时刻的生效价。
    // 之所以不用固定"当前时刻"或"模型默认价"：一天可能跨高峰/低峰多段，展示"最近一次调用当时的价"
    // 更贴近用户直觉；而实际的费用汇总仍以 token_usage_logs.cost 为准确值（不受此处影响）。
    const latestByModel = new Map<string, string>()
    for (const r of todayRows) {
      const key = r.modelId || '__none__'
      const prev = latestByModel.get(key)
      if (!prev || (r.createdAt || '') > prev) latestByModel.set(key, r.createdAt || '')
    }
    const byModelWithPricing = byModel.map((row) => {
      const at = latestByModel.get(row.modelId || '__none__') || undefined
      const { prices: effective } = resolveCurrentPrices(
        {
          inputPrice: row.inputPrice,
          outputPrice: row.outputPrice,
          cachedInputPrice: row.cachedInputPrice,
          billingRules: row.billingRules ?? null,
        },
        at ? new Date(at) : new Date(),
      )
      return {
        ...row,
        inputPrice: effective.inputPrice,
        outputPrice: effective.outputPrice,
        cachedInputPrice: effective.cachedInputPrice,
        billingRules: undefined,
      }
    })
    return {
      todayTokens: todayRows.reduce((s, r) => s + r.totalTokens, 0),
      todayCachedTokens: todayRows.reduce((s, r) => s + (r.cachedPromptTokens || 0), 0),
      todayCost: todayRows.reduce((s, r) => s + r.cost, 0),
      // 调用次数：累计模型调用轮数（一次运行可能含多轮），而非聊天/写作次数
      todayCalls: todayRows.reduce((s, r) => s + (r.calls || 1), 0),
      monthCost: monthRows.reduce((s, r) => s + r.cost, 0),
      monthCachedTokens: monthRows.reduce((s, r) => s + (r.cachedPromptTokens || 0), 0),
      monthCalls: monthRows.reduce((s, r) => s + (r.calls || 1), 0),
      byModel: byModelWithPricing,
    }
  })

  // ─── 快照 / 记忆 ──────────────────────────────────────

  ipcMain.handle('ai:getSnapshot', async (_, chapterId: string) => {
    const db = getDb()
    return db.select().from(chapterSnapshots).where(eq(chapterSnapshots.chapterId, chapterId)).get() ?? null
  })

  ipcMain.handle('ai:listSnapshotsByBook', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(chapterSnapshots).where(eq(chapterSnapshots.bookId, bookId)).orderBy(asc(chapterSnapshots.chapterOrder)).all()
  })

  ipcMain.handle('ai:getLatestSnapshot', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(chapterSnapshots).where(eq(chapterSnapshots.bookId, bookId)).orderBy(desc(chapterSnapshots.chapterOrder)).limit(1).get() ?? null
  })

  ipcMain.handle('ai:getBookMemory', async (_, bookId: string) => {
    const db = getDb()
    const mem = db.select().from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()
    if (!mem || !mem.data) {
      return { raw: null, naturalLanguage: '', empty: true }
    }
    const memory = loadBookMemory(bookId)
    const naturalLanguage = serializeBookMemory(memory)
    return { raw: mem, naturalLanguage, empty: false }
  })

  ipcMain.handle('ai:deleteBookMemory', async (_, bookId: string) => {
    const db = getDb()
    const ts = now()
    // 清空全书记忆：总记忆（最新态）+ 版本表 + 各章记忆线片段 + 章节记忆。
    // 说明：总记忆是由各章快照增量 merge 出来的聚合缓存，单独清空会导致下次定稿基于空 oldMemory 错误合并，
    // 因此"删除总记忆"必须连带清掉章节记忆，并把已定稿章节回退为"待定稿"，让书回到可重新定稿的初始记忆态。
    db.delete(timelineClips).where(eq(timelineClips.bookId, bookId)).run()
    db.delete(chapterSnapshots).where(eq(chapterSnapshots.bookId, bookId)).run()
    db.delete(bookMemory).where(eq(bookMemory.bookId, bookId)).run()
    db.delete(bookMemoryVersions).where(eq(bookMemoryVersions.bookId, bookId)).run()
    db.update(chapters).set({ status: 'completed', updatedAt: ts }).where(and(eq(chapters.bookId, bookId), eq(chapters.status, 'finalized'))).run()
    return { success: true }
  })

  // 手动更新全书总记忆（用户在总记忆页面编辑 JSON 后保存）
  ipcMain.handle('ai:updateBookMemory', async (_, data: { bookId: string; data: string }) => {
    const db = getDb()
    const row = db.select().from(bookMemory).where(eq(bookMemory.bookId, data.bookId)).get()
    if (!row) return { success: false, message: '记忆不存在，请先定稿章节生成记忆' }
    try {
      JSON.parse(data.data)
    } catch {
      return { success: false, message: '数据格式错误，不是合法的 JSON' }
    }
    db.update(bookMemory).set({ data: data.data, updatedAt: now() })
      .where(eq(bookMemory.bookId, data.bookId)).run()
    return { success: true }
  })

  ipcMain.handle('ai:listSnapshots', async (_, bookId: string) => {
    const db = getDb()
    const rows = db.select({
      id: chapterSnapshots.id,
      bookId: chapterSnapshots.bookId,
      volumeId: chapterSnapshots.volumeId,
      chapterId: chapterSnapshots.chapterId,
      chapterOrder: chapterSnapshots.chapterOrder,
      storyTime: chapterSnapshots.storyTime,
      snapshotData: chapterSnapshots.snapshotData,
      isValid: chapterSnapshots.isValid,
      createdAt: chapterSnapshots.createdAt,
      updatedAt: chapterSnapshots.updatedAt,
      chapterTitle: chapters.title,
    }).from(chapterSnapshots)
      .leftJoin(chapters, eq(chapterSnapshots.chapterId, chapters.id))
      .where(eq(chapterSnapshots.bookId, bookId))
      .orderBy(asc(chapterSnapshots.chapterOrder))
      .all()
    return rows
  })

  ipcMain.handle('ai:saveSnapshot', async (_, data: { snapshotId: string; snapshotData: any; storyTime?: string }) => {
    const db = getDb()
    const existing = db.select().from(chapterSnapshots).where(eq(chapterSnapshots.id, data.snapshotId)).get()
    const ts = now()
    if (existing) {
      db.update(chapterSnapshots).set({
        snapshotData: typeof data.snapshotData === 'string' ? data.snapshotData : JSON.stringify(data.snapshotData),
        storyTime: data.storyTime ?? existing.storyTime,
        updatedAt: ts,
      }).where(eq(chapterSnapshots.id, data.snapshotId)).run()
    }
    return { success: true }
  })

  ipcMain.handle('ai:validateSnapshot', async (_, data: { snapshotId: string; isValid: boolean }) => {
    const db = getDb()
    db.update(chapterSnapshots).set({ isValid: data.isValid, updatedAt: now() }).where(eq(chapterSnapshots.id, data.snapshotId)).run()
    return { success: true }
  })

  ipcMain.handle('ai:applyChapterSnapshot', async (_, data: { bookId: string; chapterId: string; snapshotData: any; cascadeDeleteAfter?: boolean }) => {
    const db = getDb()
    const chapter = db.select().from(chapters).where(eq(chapters.id, data.chapterId)).get()
    if (!chapter) throw new Error('章节不存在')
    const snapshotContent = typeof data.snapshotData === 'string' ? data.snapshotData : JSON.stringify(data.snapshotData)
    const parsedSnapshot = (() => {
      try { return JSON.parse(snapshotContent) } catch { return null }
    })()
    const restoredContent = parsedSnapshot?.currentPlot?.lastPlot || snapshotContent
    const wordCount = (restoredContent.match(/[\u4e00-\u9fa5]/g) || []).length + (restoredContent.match(/[a-zA-Z]+/g) || []).length
    db.update(chapters).set({ content: typeof restoredContent === 'string' ? restoredContent : snapshotContent, wordCount, updatedAt: now() }).where(eq(chapters.id, data.chapterId)).run()
    if (data.cascadeDeleteAfter) {
      const chapterOrder = chapter.sortOrder
      // 删除后续章节的剧情线
      const laterChapters = db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.bookId, data.bookId), gt(chapters.sortOrder, chapterOrder))).all()
      const laterChapterIds = laterChapters.map((c: any) => c.id)
      if (laterChapterIds.length > 0) {
        for (const cid of laterChapterIds) {
          db.delete(timelineClips).where(eq(timelineClips.chapterId, cid)).run()
        }
      }
      db.delete(chapterSnapshots).where(and(eq(chapterSnapshots.bookId, data.bookId), gt(chapterSnapshots.chapterOrder, chapterOrder))).run()
    }
    return { success: true }
  })

  ipcMain.handle('ai:checkChapterSnapshotConflicts', async (_, data: { bookId: string; chapterId: string }) => {
    const db = getDb()
    const chapter = db.select().from(chapters).where(eq(chapters.id, data.chapterId)).get()
    if (!chapter) return { hasConflict: false, reason: 'chapter_not_found' }
    const snapshot = db.select().from(chapterSnapshots).where(eq(chapterSnapshots.chapterId, data.chapterId)).get()
    if (!snapshot) return { hasConflict: false, reason: 'no_snapshot' }
    const updatedAt = new Date(chapter.updatedAt).getTime()
    const snapshotUpdatedAt = new Date(snapshot.updatedAt).getTime()
    if (updatedAt > snapshotUpdatedAt) {
      return { hasConflict: true, reason: 'chapter_modified_after_snapshot' }
    }
    return { hasConflict: false }
  })

  ipcMain.handle('ai:deleteChapterSnapshot', async (_, data: { bookId: string; chapterId: string }) => {
    const db = getDb()
    const ts = now()
    // 定位当前章节，确定其 sortOrder
    const current = db.select({ sortOrder: chapters.sortOrder }).from(chapters).where(eq(chapters.id, data.chapterId)).get()
    if (!current) return { success: true, deletedChapterCount: 0 }

    // 目标章节集 = 当前章 + 后续所有 sortOrder 更大的章节。
    // 记忆线只能从前往后累积：删掉某章记忆后，其后续章节基于"前文"生成的记忆都不再可信，必须一并清空，
    // 否则会出现"前情记忆缺失/失准"且无法重新触发定稿（状态仍是 finalized）。
    const targetChapters = db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.bookId, data.bookId), gte(chapters.sortOrder, current.sortOrder)))
      .all()
    const targetIds = targetChapters.map((c) => c.id)

    // 1) 清理关联剧情线片段及跨章链接
    const targetClips = db
      .select({ id: timelineClips.id, prevClipId: timelineClips.prevClipId })
      .from(timelineClips)
      .where(and(eq(timelineClips.bookId, data.bookId), inArray(timelineClips.chapterId, targetIds)))
      .all()
    // 1a) 被删片段引用的上一章片段（可能在保留区）的 nextClipId → 置空，避免"保留区 → 被删区"断链成环
    for (const clip of targetClips) {
      if (clip.prevClipId) {
        db.update(timelineClips).set({ nextClipId: null, updatedAt: ts }).where(eq(timelineClips.id, clip.prevClipId)).run()
      }
    }
    // 1b) 后续片段（prevClipId 指向被删片段）的 prevClipId → 置空（覆盖目标集内部及潜在跨章引用）
    for (const clip of targetClips) {
      const nextClips = db.select({ id: timelineClips.id }).from(timelineClips).where(eq(timelineClips.prevClipId, clip.id)).all()
      for (const nc of nextClips) {
        db.update(timelineClips).set({ prevClipId: null, updatedAt: ts }).where(eq(timelineClips.id, nc.id)).run()
      }
    }
    db.delete(timelineClips).where(and(eq(timelineClips.bookId, data.bookId), inArray(timelineClips.chapterId, targetIds))).run()
    // 2) 删除快照（目标章节集）
    db.delete(chapterSnapshots).where(and(eq(chapterSnapshots.bookId, data.bookId), inArray(chapterSnapshots.chapterId, targetIds))).run()
    // 3) 章节状态回退：已定稿 → 已完成待定稿（让其重新可定稿）
    db.update(chapters)
      .set({ status: 'completed', updatedAt: now() })
      .where(and(eq(chapters.bookId, data.bookId), gte(chapters.sortOrder, current.sortOrder), eq(chapters.status, 'finalized')))
      .run()

    return { success: true, deletedChapterCount: targetIds.length }
  })

  // ─── 时间线片段 ────────────────────────────────────────

  ipcMain.handle('clip:getClips', async (_, chapterId: string) => {
    const db = getDb()
    return db.select().from(timelineClips).where(eq(timelineClips.chapterId, chapterId)).orderBy(asc(timelineClips.paragraphStart)).all()
  })

  ipcMain.handle('clip:listByBook', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(timelineClips).where(eq(timelineClips.bookId, bookId)).orderBy(asc(timelineClips.createdAt)).all()
  })

  // 按章节 sortOrder 区间加载片段：用于「记忆线」大书场景的按需/可见区间加载，
  // 避免一次性拉取整本书所有片段造成的内存爆炸与加载卡顿。
  // 实现：先取区间内章节 id（轻量），再用 inArray 取这些章节的片段（与 listByBook 同形状返回）。
  ipcMain.handle('clip:listByChapterRange', async (_, bookId: string, fromOrder: number, toOrder: number) => {
    const db = getDb()
    const chaps = db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), gte(chapters.sortOrder, fromOrder), lte(chapters.sortOrder, toOrder)))
      .all()
    const ids = chaps.map((c) => c.id)
    if (ids.length === 0) return []
    return db
      .select()
      .from(timelineClips)
      .where(inArray(timelineClips.chapterId, ids))
      .orderBy(asc(timelineClips.createdAt))
      .all()
  })

  ipcMain.handle('clip:createClip', async (_, data: { bookId: string; chapterId: string; clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; snapshotId: string }) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(timelineClips).values({ id, ...data, storylineGroup: 'main', createdAt: ts, updatedAt: ts }).run()
    return { id, ...data }
  })

  ipcMain.handle('clip:updateClip', async (_, payload: { id: string; data: Partial<{ clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; prevClipId: string | null; nextClipId: string | null }> }) => {
    const db = getDb()
    db.update(timelineClips).set({ ...payload.data, updatedAt: now() }).where(eq(timelineClips.id, payload.id)).run()
    return { success: true }
  })

  ipcMain.handle('clip:deleteClip', async (_, id: string) => {
    const db = getDb()
    db.delete(timelineClips).where(eq(timelineClips.id, id)).run()
    return { success: true }
  })
}

