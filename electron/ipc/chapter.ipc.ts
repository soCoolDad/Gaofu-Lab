import { ipcMain } from 'electron'
import { getDb } from '../db'
import { chapters, volumes, chapterSnapshots, bookSettingEntries, modelProviders } from '../db/schema'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

function now() {
  return new Date().toISOString()
}

function calcWordCount(text: string): number {
  if (!text) return 0
  // 简单按中文字符 + 英文单词数估算
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const english = (text.match(/[a-zA-Z]+/g) || []).length
  return chinese + english
}

export function registerChapterIpc() {
  // 查询某本书所有章节（按 sortOrder 排序）
  // 性能优化：仅返回列表所需字段，不包含 content 大正文，避免每次切书就把整本书正文经 IPC 传到 renderer。
  // 编辑器打开单章时通过 chapter:get 单独拉取 content。
  ipcMain.handle('chapter:list', async (_, bookId: string) => {
    const db = getDb()
    return db
      .select({
        id: chapters.id,
        bookId: chapters.bookId,
        volumeId: chapters.volumeId,
        title: chapters.title,
        summary: chapters.summary,
        outline: chapters.outline,
        wordCount: chapters.wordCount,
        status: chapters.status,
        sortOrder: chapters.sortOrder,
        createdAt: chapters.createdAt,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.sortOrder))
      .all()
  })

  ipcMain.handle('chapter:listPaged', async (_, data: { bookId: string; page: number; pageSize: number; volumeId?: string | null }) => {
    const db = getDb()
    const page = Math.max(1, Number(data.page) || 1)
    const pageSize = Math.max(1, Math.min(100, Number(data.pageSize) || 10))
    const offset = (page - 1) * pageSize
    let conditions: any[] = [eq(chapters.bookId, data.bookId)]
    if (data.volumeId === '__none__') {
      conditions.push(isNull(chapters.volumeId))
    } else if (data.volumeId) {
      conditions.push(eq(chapters.volumeId, data.volumeId))
    }
    const where = and(...conditions)
    const totalRow = db.select({ count: sql<number>`count(*)` }).from(chapters).where(where).get()
    const items = db
      .select({
        id: chapters.id,
        bookId: chapters.bookId,
        volumeId: chapters.volumeId,
        volumeTitle: volumes.title,
        title: chapters.title,
        summary: chapters.summary,
        outline: chapters.outline,
        content: chapters.content,
        wordCount: chapters.wordCount,
        status: chapters.status,
        sortOrder: chapters.sortOrder,
        createdAt: chapters.createdAt,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .leftJoin(volumes, eq(chapters.volumeId, volumes.id))
      .where(where)
      .orderBy(asc(chapters.sortOrder))
      .limit(pageSize)
      .offset(offset)
      .all()
    return { items, total: Number(totalRow?.count || 0), page, pageSize }
  })

  // 查询单个章节
  ipcMain.handle('chapter:get', async (_, id: string) => {
    const db = getDb()
    return db.select().from(chapters).where(eq(chapters.id, id)).get() ?? null
  })

  // 查询某本书的统计
  // 性能优化：改用 SQL 聚合，一次扫描表即可得出 3 个数字，避免把整本书 chapters（含 content）全部拉到内存再 reduce。
  ipcMain.handle('chapter:stats', async (_, bookId: string) => {
    const db = getDb()
    const row = db
      .select({
        totalWords: sql<number>`COALESCE(SUM(${chapters.wordCount}), 0)`,
        totalChapters: sql<number>`COUNT(*)`,
        completedCount: sql<number>`SUM(CASE WHEN ${chapters.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .get()
    return {
      totalWords: Number(row?.totalWords || 0),
      totalChapters: Number(row?.totalChapters || 0),
      completedCount: Number(row?.completedCount || 0),
    }
  })

  // 创建章节
  ipcMain.handle('chapter:create', async (_, data: {
    bookId: string
    volumeId?: string
    title: string
    summary?: string
    outline?: string
    sortOrder?: number
  }) => {
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(chapters).values({
      id,
      bookId: data.bookId,
      volumeId: data.volumeId ?? null,
      title: data.title,
      summary: data.summary ?? '',
      outline: data.outline ?? '',
      content: '',
      wordCount: 0,
      status: 'draft',
      sortOrder: data.sortOrder ?? 0,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(chapters).where(eq(chapters.id, id)).get()
  })

  ipcMain.handle('chapter:bulkCreate', async (_, data: {
    bookId: string
    mode?: 'append' | 'replace'
    chapters: Array<{
      title: string
      summary?: string
      outline?: string
      volumeId?: string | null
      volumeTitle?: string | null
    }>
  }) => {
    const db = getDb()
    const ts = now()
    if (data.mode === 'replace') {
      db.delete(chapters).where(eq(chapters.bookId, data.bookId)).run()
    }
    const existing = db.select().from(chapters).where(eq(chapters.bookId, data.bookId)).orderBy(desc(chapters.sortOrder)).get()
    const startOrder = data.mode === 'replace' ? 0 : (existing?.sortOrder ?? -1) + 1
    const volumeList = db.select().from(volumes).where(eq(volumes.bookId, data.bookId)).all()
    const normalize = (value: string) => value.replace(/[\s:：》《<>「」『』【】\-—_]/g, '').toLowerCase()
    const rows = data.chapters.map((item, index) => {
      const matchedVolume = item.volumeId
        ? volumeList.find((v) => v.id === item.volumeId)
        : item.volumeTitle
          ? volumeList.find((v) => normalize(v.title) === normalize(item.volumeTitle || ''))
          : null
      return {
        id: uuidv4(),
        bookId: data.bookId,
        volumeId: matchedVolume?.id ?? null,
        title: item.title,
        summary: item.summary ?? '',
        outline: item.outline ?? '',
        content: '',
        wordCount: 0,
        status: 'draft',
        sortOrder: startOrder + index,
        createdAt: ts,
        updatedAt: ts,
      }
    })
    if (rows.length > 0) db.insert(chapters).values(rows).run()
    return db.select().from(chapters).where(eq(chapters.bookId, data.bookId)).orderBy(asc(chapters.sortOrder)).all()
  })

  // 更新章节
  ipcMain.handle('chapter:update', async (_, id: string, data: {
    title?: string
    summary?: string
    outline?: string
    content?: string
    status?: string
    volumeId?: string
    sortOrder?: number
  }) => {
    const db = getDb()
    const updateData: Record<string, unknown> = { updatedAt: now() }
    if (data.title !== undefined) updateData.title = data.title
    if (data.summary !== undefined) updateData.summary = data.summary
    if (data.outline !== undefined) updateData.outline = data.outline
    if (data.status !== undefined) updateData.status = data.status
    if (data.volumeId !== undefined) updateData.volumeId = data.volumeId
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder
    if (data.content !== undefined) {
      updateData.content = data.content
      updateData.wordCount = calcWordCount(data.content)
    }
    const oldChapter = db.select().from(chapters).where(eq(chapters.id, id)).get()

    // @ts-ignore - Drizzle 类型较复杂，此处手动构造
    db.update(chapters).set(updateData).where(eq(chapters.id, id)).run()
    const updatedChapter = db.select().from(chapters).where(eq(chapters.id, id)).get()

    if (data.status !== undefined && updatedChapter) {
      // 新版定稿流程：定稿由用户主动通过「知卷」聊天流触发，不在此处自动触发快照生成
      // 从 finalized 回退时需要把已有快照置为 invalid
      if (oldChapter?.status === 'finalized' && data.status !== 'finalized') {
        const existingSnapshot = db.select().from(chapterSnapshots).where(eq(chapterSnapshots.chapterId, id)).get()
        if (existingSnapshot) {
          db.update(chapterSnapshots).set({ isValid: false, updatedAt: now() }).where(eq(chapterSnapshots.id, existingSnapshot.id)).run()
        }
      }
    }

    return updatedChapter
  })

  // 删除章节
  ipcMain.handle('chapter:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(chapters).where(eq(chapters.id, id)).run()
    return true
  })

  // ==================== 分卷 ====================
  ipcMain.handle('volume:list', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(volumes).where(eq(volumes.bookId, bookId)).orderBy(asc(volumes.sortOrder)).all()
  })

  ipcMain.handle('volume:create', async (_, data: { bookId: string; title: string; description?: string; outline?: string; sortOrder?: number }) => {
    const db = getDb()
    const id = uuidv4()
    db.insert(volumes).values({
      id,
      bookId: data.bookId,
      title: data.title,
      description: data.description ?? '',
      outline: data.outline ?? '',
      sortOrder: data.sortOrder ?? 0,
    }).run()
    return db.select().from(volumes).where(eq(volumes.id, id)).get()
  })

  ipcMain.handle('volume:bulkCreate', async (_, data: {
    bookId: string
    mode?: 'append' | 'replace'
    volumes: Array<{ title: string; description?: string; outline?: string }>
  }) => {
    const db = getDb()
    if (data.mode === 'replace') {
      const existingVolumes = db.select().from(volumes).where(eq(volumes.bookId, data.bookId)).all()
      const ids = existingVolumes.map((v) => v.id)
      if (ids.length > 0) {
        db.update(chapters).set({ volumeId: null, updatedAt: now() }).where(inArray(chapters.volumeId, ids)).run()
      }
      db.delete(volumes).where(eq(volumes.bookId, data.bookId)).run()
    }
    const existing = db.select().from(volumes).where(eq(volumes.bookId, data.bookId)).orderBy(desc(volumes.sortOrder)).get()
    const startOrder = data.mode === 'replace' ? 0 : (existing?.sortOrder ?? -1) + 1
    const rows = data.volumes.map((item, index) => ({
      id: uuidv4(),
      bookId: data.bookId,
      title: item.title,
      description: item.description ?? '',
      outline: item.outline ?? '',
      sortOrder: startOrder + index,
    }))
    if (rows.length > 0) db.insert(volumes).values(rows).run()
    return db.select().from(volumes).where(eq(volumes.bookId, data.bookId)).orderBy(asc(volumes.sortOrder)).all()
  })

  ipcMain.handle('volume:update', async (_, id: string, data: Partial<{ title: string; description: string; outline: string; sortOrder: number }>) => {
    const db = getDb()
    db.update(volumes).set(data).where(eq(volumes.id, id)).run()
    return db.select().from(volumes).where(eq(volumes.id, id)).get()
  })

  ipcMain.handle('volume:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(volumes).where(eq(volumes.id, id)).run()
    return true
  })
}
