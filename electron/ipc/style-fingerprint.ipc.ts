/**
 * 文风指纹 IPC
 *
 * 职责：文风指纹的 CRUD + 提取（extractAndSummarize）+ 设激活 + 吻合度校验。
 * 提取走模型（生成约束摘要），其余纯本地 DB 操作。
 */

import { ipcMain } from 'electron'
import { eq, and, asc } from 'drizzle-orm'
import { getDb } from '../db'
import { styleFingerprints, books } from '../db/schema'
import { v4 as uuidv4 } from 'uuid'
import { extractAndSummarize, auditChapterContent } from '../agent/style'

function now() {
  return new Date().toISOString()
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 把 DB 行还原成前端可用的指纹对象（samples/metrics 反序列化） */
function rowToObject(row: typeof styleFingerprints.$inferSelect) {
  return {
    id: row.id,
    bookId: row.bookId,
    name: row.name,
    description: row.description,
    samples: safeParse<Array<{ title?: string; content: string }>>(row.samples, []),
    metrics: safeParse(row.metrics, {}),
    summary: row.summary,
    isDefault: !!row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function getById(id: string) {
  const db = getDb()
  const row = db.select().from(styleFingerprints).where(eq(styleFingerprints.id, id)).get()
  return row ? rowToObject(row) : null
}

export function registerStyleFingerprintIpc() {
  // 列出某书所有指纹
  ipcMain.handle('styleFingerprint:list', async (_, bookId: string) => {
    const db = getDb()
    const rows = db
      .select()
      .from(styleFingerprints)
      .where(eq(styleFingerprints.bookId, bookId))
      .orderBy(asc(styleFingerprints.createdAt))
      .all()
    return rows.map(rowToObject)
  })

  // 创建指纹（仅存档样本 + 元信息；metrics/summary 待 extract 生成）
  ipcMain.handle(
    'styleFingerprint:create',
    async (
      _,
      data: {
        bookId: string
        name: string
        description?: string
        samples?: Array<{ title?: string; content: string }>
      },
    ) => {
      const db = getDb()
      const id = uuidv4()
      const ts = now()
      const samples = Array.isArray(data.samples) ? data.samples : []
      // 若本书尚无激活指纹，自动把首个设为默认激活
      const hasDefault = db
        .select()
        .from(styleFingerprints)
        .where(and(eq(styleFingerprints.bookId, data.bookId), eq(styleFingerprints.isDefault, true)))
        .get()
      db.insert(styleFingerprints)
        .values({
          id,
          bookId: data.bookId,
          name: data.name,
          description: data.description || '',
          samples: JSON.stringify(samples),
          metrics: '{}',
          summary: '',
          isDefault: !hasDefault,
          createdAt: ts,
          updatedAt: ts,
        })
        .run()
      return getById(id)
    },
  )

  // 更新元信息 / 范本
  ipcMain.handle(
    'styleFingerprint:update',
    async (
      _,
      data: {
        id: string
        name?: string
        description?: string
        samples?: Array<{ title?: string; content: string }>
      },
    ) => {
      const db = getDb()
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (data.name !== undefined) updates.name = data.name
      if (data.description !== undefined) updates.description = data.description
      if (data.samples !== undefined) {
        updates.samples = JSON.stringify(data.samples)
        // 范本变了，旧摘要失效，清空 metrics/summary 强制重新提取
        updates.metrics = '{}'
        updates.summary = ''
      }
      db.update(styleFingerprints).set(updates).where(eq(styleFingerprints.id, data.id)).run()
      return getById(data.id)
    },
  )

  // 删除
  ipcMain.handle('styleFingerprint:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(styleFingerprints).where(eq(styleFingerprints.id, id)).run()
    return true
  })

  // 设为激活指纹（先清同书其他 default）
  ipcMain.handle('styleFingerprint:setDefault', async (_, id: string) => {
    const db = getDb()
    const row = db.select().from(styleFingerprints).where(eq(styleFingerprints.id, id)).get()
    if (!row) return { success: false, message: '指纹不存在' }
    if (!row.summary) return { success: false, message: '该指纹尚未提取文风摘要，无法设为激活' }
    const ts = now()
    db.transaction((tx) => {
      tx.update(styleFingerprints)
        .set({ isDefault: false, updatedAt: ts })
        .where(eq(styleFingerprints.bookId, row.bookId))
        .run()
      tx.update(styleFingerprints)
        .set({ isDefault: true, updatedAt: ts })
        .where(eq(styleFingerprints.id, id))
        .run()
    })
    return { success: true }
  })

  // 提取 + 生成摘要（调模型）。流式 reasoning 通过事件推给前端。
  ipcMain.handle(
    'styleFingerprint:extract',
    async (event, data: { id: string; modelId: string }) => {
      const db = getDb()
      const row = db.select().from(styleFingerprints).where(eq(styleFingerprints.id, data.id)).get()
      if (!row) return { success: false, message: '指纹不存在' }
      const samples = safeParse<Array<{ title?: string; content: string }>>(row.samples, [])
      if (samples.length === 0) return { success: false, message: '范本为空，无法提取' }

      const onReasoning = (delta: string) => {
        try {
          event.sender.send('styleFingerprint:extractReasoning', { id: data.id, delta })
        } catch {
          /* 窗口可能已关闭，忽略 */
        }
      }

      try {
        const book = row.bookId ? db.select().from(books).where(eq(books.id, row.bookId)).get() : null
        const { metrics, summary } = await extractAndSummarize({
          samples,
          fingerprintName: row.name,
          modelId: data.modelId,
          onReasoning,
          bookId: row.bookId ?? null,
          bookTitle: book?.title ?? null,
        })
        db.update(styleFingerprints)
          .set({ metrics: JSON.stringify(metrics), summary, updatedAt: now() })
          .where(eq(styleFingerprints.id, data.id))
          .run()
        return { success: true, fingerprint: getById(data.id) }
      } catch (err: any) {
        return { success: false, message: err?.message || '提取失败' }
      }
    },
  )

  // 对指定正文用本书激活指纹做吻合度校验（前端指纹面板测试 / 工具阶段已用同路径）
  ipcMain.handle(
    'styleFingerprint:audit',
    async (_, data: { bookId: string; content: string }) => {
      return auditChapterContent(data.bookId, data.content)
    },
  )
}
