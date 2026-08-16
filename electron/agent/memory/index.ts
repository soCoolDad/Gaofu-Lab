/**
 * 记忆模块 v2（以 book_memory 表为主）
 *
 * 数据流：
 *  - 单章记忆（ChapterMemoryV2）：由「定稿」触发生成，写入 chapter_snapshots.snapshotData
 *  - 总记忆（BookMemoryV2）：单章记忆落库后，由 memory/merger.ts 增量维护到 book_memory.data
 *  - 写手需要的注入文本：由 memory/serializer.ts 把两者转成自然语言
 */

import { eq, and, lt, gte, asc, desc } from 'drizzle-orm'
import { getDb } from '../../db'
import { chapters, volumes, outlines, chapterSnapshots, bookMemory as bookMemoryTable, bookMemoryVersions } from '../../db/schema'
import type {
  BookMemoryV2,
  ChapterMemoryV2,
  ContextKey,
} from '../types'
import { emptyBookMemory, mergeIntoBookMemory } from './merger'
import { serializeBookMemory, serializeChapterMemory } from './serializer'

// ─── book_memory 读写 ────────────────────────────────────────

/** 读总记忆；不存在则返回空的 v2 结构 */
export function loadBookMemory(bookId: string): BookMemoryV2 {
  const db = getDb()
  const row = db.select().from(bookMemoryTable).where(eq(bookMemoryTable.bookId, bookId)).get()
  if (!row || !row.data) return emptyBookMemory(bookId)
  try {
    const parsed = JSON.parse(row.data) as BookMemoryV2
    // 兜底：确保关键字段一定存在，避免旧数据/损坏数据造成后续 undefined 访问
    return {
      bookId: parsed.bookId || bookId,
      updatedThroughChapterOrder: parsed.updatedThroughChapterOrder || 0,
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      locations: Array.isArray(parsed.locations) ? parsed.locations : [],
      plots: Array.isArray(parsed.plots) ? parsed.plots : [],
      foreshadowings: Array.isArray(parsed.foreshadowings) ? parsed.foreshadowings : [],
      inspirations: Array.isArray(parsed.inspirations) ? parsed.inspirations : [],
    }
  } catch {
    return emptyBookMemory(bookId)
  }
}

/** 覆盖式写总记忆（仅写 book_memory，不管版本表） */
export function saveBookMemory(memory: BookMemoryV2): void {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = db.select().from(bookMemoryTable).where(eq(bookMemoryTable.bookId, memory.bookId)).get()
  const payload = {
    bookId: memory.bookId,
    data: JSON.stringify(memory),
    updatedThroughChapterOrder: memory.updatedThroughChapterOrder,
    updatedAt: now,
  }
  if (existing) {
    db.update(bookMemoryTable).set(payload).where(eq(bookMemoryTable.bookId, memory.bookId)).run()
  } else {
    db.insert(bookMemoryTable).values(payload).run()
  }
}

/**
 * 版本化写入：同时更新 book_memory（最新态快查缓存）+ 追加一条 book_memory_versions
 * （用于将来 O(1) 回滚到"某一章末的总记忆"）。
 *
 * versionChapterOrder 表示"这版总记忆是聚合到第几章为止的产物"（0-based，与 chapters.sortOrder 一致）。
 * 相同 (bookId, chapterOrder) 会覆盖：因为同一章可能重新定稿多次，只保留最新的合并结果。
 */
export function saveBookMemoryWithVersion(memory: BookMemoryV2, versionChapterOrder: number): void {
  saveBookMemory(memory)

  const db = getDb()
  const now = new Date().toISOString()
  const data = JSON.stringify(memory)
  const existing = db.select({ chapterOrder: bookMemoryVersions.chapterOrder })
    .from(bookMemoryVersions)
    .where(and(eq(bookMemoryVersions.bookId, memory.bookId), eq(bookMemoryVersions.chapterOrder, versionChapterOrder)))
    .get()
  if (existing) {
    db.update(bookMemoryVersions)
      .set({ data, createdAt: now })
      .where(and(eq(bookMemoryVersions.bookId, memory.bookId), eq(bookMemoryVersions.chapterOrder, versionChapterOrder)))
      .run()
  } else {
    db.insert(bookMemoryVersions).values({
      bookId: memory.bookId,
      chapterOrder: versionChapterOrder,
      data,
      createdAt: now,
    }).run()
  }
}

/**
 * O(1) 快速回滚：把 book_memory 恢复到"第 rollbackToOrderExclusive 章之前"的状态。
 *
 * 场景：用户删除了 chapterOrder = N 及其后续章节的记忆 → 调用 `rollbackBookMemoryBefore(bookId, N)`。
 *
 * 实现：
 *  1. 从 book_memory_versions 里查 chapterOrder < N 的最新一行（一次索引查询，O(log 版本数)）
 *  2. 若有 → 把它的 data 写回 book_memory；同时删除 chapterOrder >= N 的所有版本记录（保持一致性）
 *  3. 若没有（说明连第一章都被删了）→ book_memory 清空 + 版本表清空
 *
 * 这样删章节记忆不需要"从第 1 章重放合并"，几百章级别的书也能瞬时回滚。
 */
export function rollbackBookMemoryBefore(bookId: string, rollbackToOrderExclusive: number): BookMemoryV2 {
  const db = getDb()

  // 1. 找 chapterOrder < N 的最新版本
  const lastValid = db.select({
    chapterOrder: bookMemoryVersions.chapterOrder,
    data: bookMemoryVersions.data,
  })
    .from(bookMemoryVersions)
    .where(and(
      eq(bookMemoryVersions.bookId, bookId),
      lt(bookMemoryVersions.chapterOrder, rollbackToOrderExclusive),
    ))
    .orderBy(desc(bookMemoryVersions.chapterOrder))
    .limit(1)
    .get()

  // 2. 删除 chapterOrder >= N 的所有版本（这些已经无效）
  db.delete(bookMemoryVersions)
    .where(and(
      eq(bookMemoryVersions.bookId, bookId),
      gte(bookMemoryVersions.chapterOrder, rollbackToOrderExclusive),
    ))
    .run()

  // 3. 恢复或清空 book_memory
  if (lastValid?.data) {
    try {
      const parsed = JSON.parse(lastValid.data) as BookMemoryV2
      saveBookMemory(parsed)
      return parsed
    } catch {
      // 版本数据损坏 → 兜底为空
    }
  }
  const empty = emptyBookMemory(bookId)
  saveBookMemory(empty)
  return empty
}

/**
 * 从「剩余的 chapter_snapshots」重新构建 book_memory。
 *
 * 已由「版本化 O(1) 回滚」取代日常路径；这个函数仅作为"版本表被清空/损坏时的最后兜底"保留。
 * 使用场景：
 *  - 老库升级时首次填充 book_memory_versions
 *  - 用户手工调整章节顺序后需要一致性重建
 *
 * 实现方式：读所有仍有效的 chapter_snapshots，按 chapterOrder 升序，从空 BookMemory 起
 * 逐章 `mergeIntoBookMemory`。会同时把每一步的中间态写入 book_memory_versions，
 * 让后续删除操作可以走 O(1) 快速回滚。
 */
export function rebuildBookMemoryFromChapters(bookId: string): BookMemoryV2 {
  const db = getDb()
  const snapshots = db.select({
    chapterId: chapterSnapshots.chapterId,
    chapterOrder: chapterSnapshots.chapterOrder,
    snapshotData: chapterSnapshots.snapshotData,
    createdAt: chapterSnapshots.createdAt,
  }).from(chapterSnapshots).where(eq(chapterSnapshots.bookId, bookId)).all()

  // 章节标题一次拉全
  const chapterRows = db.select({
    id: chapters.id,
    title: chapters.title,
  }).from(chapters).where(eq(chapters.bookId, bookId)).all()
  const titleById = new Map<string, string>()
  for (const c of chapterRows) titleById.set(c.id, c.title || '')

  // 同章 order 多条快照 → 取 createdAt 最新
  const latestByOrder = new Map<number, typeof snapshots[number]>()
  for (const s of snapshots) {
    const cur = latestByOrder.get(s.chapterOrder)
    if (!cur || (s.createdAt || '') > (cur.createdAt || '')) {
      latestByOrder.set(s.chapterOrder, s)
    }
  }
  const ordered = Array.from(latestByOrder.values()).sort((a, b) => a.chapterOrder - b.chapterOrder)

  // 清空旧版本表（rebuild 会重新按章追加所有中间态）
  db.delete(bookMemoryVersions).where(eq(bookMemoryVersions.bookId, bookId)).run()

  let memory: BookMemoryV2 = emptyBookMemory(bookId)
  for (const snap of ordered) {
    let parsed: ChapterMemoryV2 | null = null
    try {
      parsed = typeof snap.snapshotData === 'string' ? JSON.parse(snap.snapshotData) : (snap.snapshotData as any)
    } catch {}
    if (!parsed) continue
    memory = mergeIntoBookMemory(memory, snap.chapterOrder, parsed, titleById.get(snap.chapterId))
    saveBookMemoryWithVersion(memory, snap.chapterOrder)
  }

  if (ordered.length === 0) {
    saveBookMemory(memory)
  }
  return memory
}

// ─── 供 agent 用的注入文本构造 ────────────────────────────────

/**
 * 获取记忆注入文本。参数：
 *  - currentChapterOrder：当前正在写的章节 sortOrder（用于挑"上一章"）；缺省则不注入上一章记忆
 *
 * 结构：
 *   #全书总记忆#（引导行：以下内容作为参考：）(BookMemoryV2 序列化)
 *   #上一章记忆#（引导行：以下内容作为参考：）(ChapterMemoryV2 序列化，取 sortOrder = currentChapterOrder - 1)
 */
export function getMemoryText(bookId: string | null, currentChapterOrder?: number): string | undefined {
  if (!bookId) return undefined
  const total = loadBookMemory(bookId)
  const parts: string[] = []
  if (total.updatedThroughChapterOrder > 0 || total.characters.length > 0) {
    parts.push(serializeBookMemory(total))
  }

  if (typeof currentChapterOrder === 'number' && currentChapterOrder > 0) {
    const lastMem = loadChapterMemoryByOrder(bookId, currentChapterOrder - 1)
    if (lastMem) {
      const { memory, title } = lastMem
      const memLines: string[] = ['#上一章记忆#', '以下内容作为参考：']
      if (title) memLines.push('标题', title)
      memLines.push('内容', serializeChapterMemory(memory, currentChapterOrder - 1, title))
      parts.push(memLines.join('\n'))
    }
  }

  const joined = parts.join('\n\n---\n\n').trim()
  return joined || undefined
}

/** 读某一章的最新单章记忆（chapter_snapshots.snapshotData 里的 v2 JSON） */
export function loadChapterMemoryByOrder(
  bookId: string,
  chapterOrder: number,
): { memory: ChapterMemoryV2; title?: string } | null {
  const db = getDb()
  const ch = db.select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.sortOrder))
    .all()
    .find((c) => c.sortOrder === chapterOrder)
  if (!ch) return null
  const snap = db.select().from(chapterSnapshots)
    .where(eq(chapterSnapshots.chapterId, ch.id))
    .orderBy(desc(chapterSnapshots.createdAt))
    .limit(1)
    .get()
  if (!snap?.snapshotData) return null
  try {
    return { memory: JSON.parse(snap.snapshotData) as ChapterMemoryV2, title: ch.title }
  } catch {
    return null
  }
}

/**
 * 半静态上下文：全书大纲 + 本卷大纲。
 * 仅在全书大纲/分卷大纲修改时变化，可放 system 消息前缀充分利用 prompt cache。
 */
export function buildSemiStaticContext(bookId: string, volumeId?: string | null): string | undefined {
  const db = getDb()
  const parts: string[] = []

  const bookOutline = db.select().from(outlines).where(
    and(eq(outlines.bookId, bookId), eq(outlines.type, 'book')),
  ).get()
  if (bookOutline?.content) {
    parts.push(`#全书大纲#\n以下内容作为参考：\n${bookOutline.content}`)
  }

  if (volumeId) {
    const vol = db.select({ title: volumes.title }).from(volumes).where(eq(volumes.id, volumeId)).get()
    const volOutlineContent = getVolumeOutlineContent(bookId, volumeId)
    if (volOutlineContent) {
      const lines: string[] = ['#本卷大纲', '以下内容作为参考：']
      if (vol?.title) lines.push('标题', vol.title)
      lines.push('内容', volOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined
}

/**
 * 按工具需求构建上下文：按需取全书大纲/本卷大纲/本章大纲/创作记忆的子集。
 * 每轮根据模型调用的工具决定注入哪些内容，避免把写正文的记忆带到创建章节的轮次。
 */
export function buildContextByRequirements(
  bookId: string,
  needs: { memory?: boolean; bookOutline?: boolean; volumeOutline?: boolean; chapterOutline?: boolean },
  opts?: {
    volumeId?: string | null
    chapterId?: string | null
    currentChapterOrder?: number
  },
): string | undefined {
  const db = getDb()
  const parts: string[] = []

  // 全书总记忆 和 全书大纲 已由预加载阶段分别注入，此处不再拼接
  if (needs.volumeOutline && opts?.volumeId) {
    const vol = db.select({ title: volumes.title }).from(volumes).where(eq(volumes.id, opts.volumeId)).get()
    const volOutlineContent = getVolumeOutlineContent(bookId, opts.volumeId)
    if (volOutlineContent) {
      const lines: string[] = ['#本卷大纲', '以下内容作为参考：']
      if (vol?.title) lines.push('标题', vol.title)
      lines.push('内容', volOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  if (needs.chapterOutline && opts?.chapterId) {
    const ch = db.select({ title: chapters.title }).from(chapters).where(eq(chapters.id, opts.chapterId)).get()
    const chOutlineContent = getChapterOutlineContent(bookId, opts.chapterId)
    if (chOutlineContent) {
      const lines: string[] = ['#本章大纲', '以下内容作为参考：']
      if (ch?.title) lines.push('标题', ch.title)
      lines.push('内容', chOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  const joined = parts.join('\n\n---\n\n').trim()
  return joined || undefined
}

// ─── 卷纲/章纲取数（数据源：volumes.outline / chapters.outline 列） ──────────────
// 重要：卷纲/章纲实际存储在 volumes.outline 与 chapters.outline 列，
// 而非 outlines 表（该表仅用于全书大纲 type='book'）。以下 helper 优先读列，
// 并兼容旧数据可能落在 outlines 表 type='volume'/'chapter' 的情况。

function getVolumeOutlineContent(bookId: string, volumeId: string): string | null {
  const vol = getDb().select({ outline: volumes.outline }).from(volumes).where(eq(volumes.id, volumeId)).get()
  if (vol?.outline) return vol.outline
  const legacy = getDb().select().from(outlines).where(
    and(eq(outlines.bookId, bookId), eq(outlines.type, 'volume'), eq(outlines.targetId, volumeId)),
  ).get()
  return legacy?.content ?? null
}

function getChapterOutlineContent(bookId: string, chapterId: string): string | null {
  const ch = getDb().select({ outline: chapters.outline }).from(chapters).where(eq(chapters.id, chapterId)).get()
  if (ch?.outline) return ch.outline
  const legacy = getDb().select().from(outlines).where(
    and(eq(outlines.bookId, bookId), eq(outlines.type, 'chapter'), eq(outlines.targetId, chapterId)),
  ).get()
  return legacy?.content ?? null
}

/**
 * 构建写章节正文的上下文片段数组（每项独立，不拼接）。
 * 由知卷设置的 5 个勾选项控制是否生成对应片段。
 */
export function buildWriteContextParts(
  bookId: string,
  opts: {
    volumeId?: string | null
    chapterId?: string | null
    currentChapterOrder?: number
    volumeOutline: boolean
    chapterOutline: boolean
    prevChapterOutline: boolean
    prevChapterContent: boolean
    nextChapterOutline: boolean
    prevChapterMemory: boolean
    totalMemory: boolean
    /** 工具级上下文排除：被任意预测工具声明不需要的块直接跳过（统一在此入口生效，无需调用方逐个判断） */
    excludedContextKeys?: Set<ContextKey> | ContextKey[]
  },
): string[] {
  const db = getDb()
  const parts: string[] = []
  // 统一入口处的排除集合：调用方只要把本轮 excludedContextKeys 传进来，本函数自行按块跳过，
  // 新增块时不会因漏写 `&& !excluded` 而把本该排除的上下文注入进模型。
  const excluded = new Set<ContextKey>(opts.excludedContextKeys || [])

  // 0. 全书总记忆
  if (opts.totalMemory && !excluded.has('totalMemory')) {
    const total = loadBookMemory(bookId)
    if (total.updatedThroughChapterOrder > 0 || total.characters.length > 0) {
      parts.push(serializeBookMemory(total))
    }
  }

  // 1. 当前卷纲
  if (opts.volumeOutline && !excluded.has('volumeOutline') && opts.volumeId) {
    const vol = db.select({ title: volumes.title }).from(volumes).where(eq(volumes.id, opts.volumeId)).get()
    const volOutlineContent = getVolumeOutlineContent(bookId, opts.volumeId)
    if (volOutlineContent) {
      const lines: string[] = ['#本卷大纲', '以下内容作为参考：']
      if (vol?.title) lines.push('标题', vol.title)
      lines.push('内容', volOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  // 2. 当前章纲
  if (opts.chapterOutline && !excluded.has('chapterOutline') && opts.chapterId) {
    const ch = db.select({ title: chapters.title }).from(chapters).where(eq(chapters.id, opts.chapterId)).get()
    const chOutlineContent = getChapterOutlineContent(bookId, opts.chapterId)
    if (chOutlineContent) {
      const lines: string[] = ['#本章大纲', '以下内容作为参考：']
      if (ch?.title) lines.push('标题', ch.title)
      lines.push('内容', chOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  // 3. 上一章章纲
  if (opts.prevChapterOutline && !excluded.has('prevChapterOutline') && typeof opts.currentChapterOrder === 'number' && opts.currentChapterOrder > 0) {
    const prevCh = db.select({ id: chapters.id, title: chapters.title })
      .from(chapters).where(and(eq(chapters.bookId, bookId), eq(chapters.sortOrder, opts.currentChapterOrder - 1))).get()
    if (prevCh) {
      const prevOutlineContent = getChapterOutlineContent(bookId, prevCh.id)
      if (prevOutlineContent) {
        const lines: string[] = ['#上一章节大纲', '以下内容作为参考：']
        lines.push('标题', prevCh.title)
        lines.push('内容', prevOutlineContent)
        parts.push(lines.join('\n'))
      }
    }
  }

  // 4. 上一章正文
  if (opts.prevChapterContent && !excluded.has('prevChapterContent') && typeof opts.currentChapterOrder === 'number' && opts.currentChapterOrder > 0) {
    const prevCh = db.select({ id: chapters.id, title: chapters.title, content: chapters.content })
      .from(chapters).where(and(eq(chapters.bookId, bookId), eq(chapters.sortOrder, opts.currentChapterOrder - 1))).get()
    if (prevCh?.content) {
      const lines: string[] = ['#上一章正文', '以下内容作为参考：']
      lines.push('说明', '此块仅用于把握剧情承接点（结尾处人物状态/未了结的悬念），新章节开篇严禁复述其结尾，应切入新场景向前推进。')
      lines.push('标题', prevCh.title)
      lines.push('内容', prevCh.content)
      parts.push(lines.join('\n'))
    }
  }

  // 5. 下一章章纲
  if (opts.nextChapterOutline && !excluded.has('nextChapterOutline') && typeof opts.currentChapterOrder === 'number') {
    const nextCh = db.select({ id: chapters.id, title: chapters.title })
      .from(chapters).where(and(eq(chapters.bookId, bookId), eq(chapters.sortOrder, opts.currentChapterOrder + 1))).get()
    if (nextCh) {
      const nextOutlineContent = getChapterOutlineContent(bookId, nextCh.id)
      if (nextOutlineContent) {
        const lines: string[] = ['#下一章节大纲#', '以下内容作为参考：']
        lines.push('标题', nextCh.title)
        lines.push('内容', nextOutlineContent)
        parts.push(lines.join('\n'))
      }
    }
  }

  // 6. 上一章记忆
  if (opts.prevChapterMemory && !excluded.has('prevChapterMemory') && typeof opts.currentChapterOrder === 'number' && opts.currentChapterOrder > 0) {
    const prevMem = loadChapterMemoryByOrder(bookId, opts.currentChapterOrder - 1)
    if (prevMem) {
      const memLines: string[] = ['#上一章记忆#', '以下内容作为参考：']
      if (prevMem.title) memLines.push('标题', prevMem.title)
      memLines.push('内容', serializeChapterMemory(prevMem.memory, opts.currentChapterOrder - 1, prevMem.title))
      parts.push(memLines.join('\n'))
    }
  }

  return parts
}

/**
 * 构建单章写作上下文（记忆 + 本章大纲），每章变化。
 * 放在 user message 前缀中，不会污染 system 消息的缓存。
 */
export function buildPerChapterContext(bookId: string, opts?: {
  currentChapterOrder?: number
  chapterId?: string | null
}): string | undefined {
  const db = getDb()
  const parts: string[] = []

  const memoryText = getMemoryText(bookId, opts?.currentChapterOrder)
  if (memoryText) parts.push(memoryText)

    if (opts?.chapterId) {
      const ch = db.select({ title: chapters.title }).from(chapters).where(eq(chapters.id, opts.chapterId)).get()
      const chOutlineContent = getChapterOutlineContent(bookId, opts.chapterId)
      if (chOutlineContent) {
      const lines: string[] = ['#本章大纲', '以下内容作为参考：']
      if (ch?.title) lines.push('标题', ch.title)
      lines.push('内容', chOutlineContent)
      parts.push(lines.join('\n'))
    }
  }

  const joined = parts.join('\n\n---\n\n').trim()
  return joined || undefined
}

export function loadChapterMemoryById(chapterId: string): ChapterMemoryV2 | null {
  const db = getDb()
  const snap = db.select().from(chapterSnapshots)
    .where(eq(chapterSnapshots.chapterId, chapterId))
    .orderBy(desc(chapterSnapshots.createdAt))
    .limit(1)
    .get()
  if (!snap?.snapshotData) return null
  try {
    return JSON.parse(snap.snapshotData) as ChapterMemoryV2
  } catch {
    return null
  }
}
