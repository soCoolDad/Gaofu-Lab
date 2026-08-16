/**
 * CRUD 工具：书籍/分卷/章节/大纲/设定的查询与写操作
 *
 * read 工具：直接查询 DB 返回数据
 * write 工具：生成 PendingWrite（需用户确认应用）
 */

import { eq, and, asc, desc } from 'drizzle-orm'
import { getDb } from '../../db'
import { books, volumes, chapters, outlines, bookSettingEntries } from '../../db/schema'
import { defineReadTool, defineWriteTool } from './index'
import { createPendingWrite } from '../tool-executor'
import { cleanEditorContentFromAi } from '../../ipc/data-block-parser'
import { settingTypeLabel } from '../settings-labels'
import type { ToolHandlerResult } from './index'
import type { ToolContext } from '../types'

// ─── 书籍工具 ────────────────────────────────────────────────

const listBooksTool = defineReadTool(
  'list_books',
  '查询所有书籍列表，返回 id/标题/简介/创建时间。',
  'book',
  {},
  [],
  async (_args, _ctx) => {
    const db = getDb()
    const list = db.select({
      id: books.id,
      title: books.title,
      description: books.description,
      detail: books.detail,
      writingStyle: books.writingStyle,
      writingPov: books.writingPov,
      writingWordCountTarget: books.writingWordCountTarget,
      writingTaboo: books.writingTaboo,
      createdAt: books.createdAt,
      updatedAt: books.updatedAt,
    }).from(books).orderBy(desc(books.createdAt)).all()
    return { data: list }
  },
)

const getBookTool = defineReadTool(
  'get_book',
  '查询指定书籍的详细信息。bookId 不填则用当前选中书籍。',
  'book',
  { bookId: { type: 'string', description: '书籍 ID（可选）' } },
  [],
  async (args, ctx) => {
    const db = getDb()
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const book = db.select().from(books).where(eq(books.id, bookId)).get()
    if (!book) return { error: '书籍不存在' }
    return { data: book }
  },
)

const createBookTool = defineWriteTool(
  'create_book',
  '创建新书籍，生成待应用的书籍数据。创建时必须生成书名、简介、详细简介。',
  'book',
  {
    title: { type: 'string', description: '书籍标题。根据用户输入或创作需求自动生成一个有吸引力的书名。' },
    description: { type: 'string', description: '书籍简介（50-200字），概括书籍的核心理念和风格。必填。' },
    detail: { type: 'string', description: '详细描述（200-1000字），包含世界观设定、主题思想、故事背景等。必填。' },
    writingStyle: { type: 'string', description: '写作风格（可选），如：轻松幽默、严肃史诗、悬疑紧张等。' },
    writingPov: { type: 'string', description: '叙事视角（可选），如：第一人称、第三人称有限、第三人称全知等。' },
    writingConstraint: { type: 'string', description: '写作约束（可选），对写手的额外要求，如叙事节奏、对话比例、章节结尾方式等。' },
  },
  ['title'],
  async (args) => {
    return {
      pendingWrite: createPendingWrite({
        type: 'book_info',
        title: `创建书籍《${args.title}》`,
        summary: args.description || '',
        applyMode: 'insert',
        data: {
          title: args.title,
          description: args.description || '',
          detail: args.detail || '',
          writingStyle: args.writingStyle || '',
          writingPov: args.writingPov || '',
          writingConstraint: args.writingConstraint || '',
        },
        preview: {
          title: args.title,
          summary: args.description || '',
          content: args.detail || '',
        },
        riskLevel: 'low',
      }),
    }
  },
)

const updateBookTool = defineWriteTool(
  'update_book',
  '更新书籍信息（标题/简介/写作风格等），生成待应用的更新。',
  'book',
  {
    bookId: { type: 'string', description: '书籍 ID（不填则用当前选中书籍）' },
    title: { type: 'string', description: '新标题（可选）' },
    description: { type: 'string', description: '新简介（可选）' },
    writingStyle: { type: 'string', description: '写作风格（可选）' },
    writingPov: { type: 'string', description: '叙事视角（可选）' },
    writingWordCountTarget: { type: 'string', description: '字数目标（可选）' },
    writingTaboo: { type: 'string', description: '写作禁忌（可选）' },
    writingConstraint: { type: 'string', description: '写作约束（可选）' },
  },
  [],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const book = db.select().from(books).where(eq(books.id, bookId)).get()
    if (!book) return { error: '书籍不存在' }
    const updates: Record<string, any> = {}
    for (const key of ['title', 'description', 'writingStyle', 'writingPov', 'writingWordCountTarget', 'writingTaboo', 'writingConstraint']) {
      if (args[key] !== undefined) updates[key] = args[key]
    }
    return {
      pendingWrite: createPendingWrite({
        type: 'book_info',
        title: `更新书籍《${book.title}》`,
        summary: Object.keys(updates).join(', '),
        target: { bookId, entityType: 'book' },
        applyMode: 'replace',
        data: updates,
        preview: { title: book.title, summary: JSON.stringify(updates, null, 2) },
        riskLevel: 'medium',
      }),
    }
  },
)

// ─── 分卷工具 ────────────────────────────────────────────────

const listVolumesTool = defineReadTool(
  'list_volumes',
  '查询书籍的所有分卷。bookId 不填则用当前选中书籍。',
  'volume',
  { bookId: { type: 'string', description: '书籍 ID（可选，默认当前书籍）' } },
  [],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const list = db.select().from(volumes).where(eq(volumes.bookId, bookId)).orderBy(asc(volumes.sortOrder)).all()
    return { data: list }
  },
)

const createVolumesTool = defineWriteTool(
  'create_volumes',
  '批量创建分卷。每个分卷必须包含 title/description/outline 三个必填字段。创建后如需继续创建章节，使用 is_prerequisite 参数标记。',
  'volume',
  {
    volumes: {
      type: 'array',
      description: '分卷列表，每项需包含 title/description/outline',
      items: {
        type: 'object',
        description: '分卷对象；三个字段全部必填',
        properties: {
          title: { type: 'string', description: '【必填】分卷标题' },
          description: { type: 'string', description: '【必填】分卷简介' },
          outline: { type: 'string', description: '【必填】分卷剧情大纲。结构规范见系统消息中的工具提示词。' },
        },
        required: ['title', 'description', 'outline'],
      },
    },
  },
  ['volumes'],
  async (args, ctx) => {
    const bookId = ctx.bookId
    if (!bookId) return { error: '当前无选中书籍' }
    // 防御性：模型可能返回非数组的 volumes（比如 null、object、字符串），统一收敛为数组
    const rawVolumes: any[] = Array.isArray(args.volumes) ? args.volumes : []
    if (rawVolumes.length === 0) return { error: 'volumes 参数为空或不是数组，无法创建分卷' }

    // 服务端校验：确保每个分卷都包含 title / description / outline 三个非空字段。
    // JSON Schema 的 required 在很多本地/兼容模型上被忽略，因此这里做兜底并把缺失信息回注给模型，
    // 让 Agent 有机会重试补全（tool 返回 error → 下一轮模型会读到这个错误自行修正）。
    const missing: Array<{ index: number; missing: string[] }> = []
    rawVolumes.forEach((v: any, idx: number) => {
      const miss: string[] = []
      if (!v || typeof v.title !== 'string' || !v.title.trim()) miss.push('title')
      if (!v || typeof v.description !== 'string' || !v.description.trim()) miss.push('description')
      if (!v || typeof v.outline !== 'string' || !v.outline.trim()) miss.push('outline')
      if (miss.length > 0) missing.push({ index: idx, missing: miss })
    })
    if (missing.length > 0) {
      const detailsStr = missing.map(m => `第${m.index + 1}个分卷缺失：${m.missing.join('、')}`).join('；')
      return {
        error: `有分卷缺失必填字段，请补齐后重试。每个分卷必须同时包含 title / description / outline 三项，且都不能为空字符串。详情：${detailsStr}`,
      }
    }

    const volumes = rawVolumes
    return {
      pendingWrite: createPendingWrite({
        type: 'volume_list',
        title: `创建 ${volumes.length} 个分卷`,
        summary: volumes.map((v: any) => v?.title || '未命名').join('、'),
        target: { bookId, entityType: 'volume' },
        applyMode: 'append',
        data: { items: volumes },
        preview: { items: volumes },
        riskLevel: 'low',
      }),
    }
  },
)

const updateVolumeOutlineTool = defineWriteTool(
  'update_volume_outline',
  '更新分卷的剧情大纲，生成待应用的更新。',
  'volume',
  {
    volumeId: { type: 'string', description: '分卷 ID' },
    outline: { type: 'string', description: '新的剧情大纲内容。结构规范见系统消息中的工具提示词。' },
  },
  ['volumeId', 'outline'],
  async (args) => {
    const db = getDb()
    const vol = db.select().from(volumes).where(eq(volumes.id, args.volumeId)).get()
    if (!vol) return { error: '分卷不存在' }
    return {
      pendingWrite: createPendingWrite({
        type: 'volume_outline',
        title: `更新分卷《${vol.title}》大纲`,
        summary: args.outline.slice(0, 100) + '...',
        target: { volumeId: args.volumeId, entityType: 'volume' },
        applyMode: 'replace',
        data: { outline: args.outline },
        preview: { title: vol.title, summary: args.outline.slice(0, 200) },
        riskLevel: 'low',
      }),
    }
  },
)

const getVolumeTool = defineReadTool(
  'get_volume',
  '查询单个分卷的详细信息（标题/简介/大纲/排序）。需要 volumeId。',
  'volume',
  { volumeId: { type: 'string', description: '分卷 ID' } },
  ['volumeId'],
  async (args) => {
    const db = getDb()
    const vol = db.select().from(volumes).where(eq(volumes.id, args.volumeId)).get()
    if (!vol) return { error: '分卷不存在' }
    return { data: vol }
  },
)

const updateVolumeTool = defineWriteTool(
  'update_volume',
  '更新分卷的标题/简介（不改变大纲；改大纲用 update_volume_outline），生成待应用的更新。',
  'volume',
  {
    volumeId: { type: 'string', description: '分卷 ID' },
    title: { type: 'string', description: '新标题（可选）' },
    description: { type: 'string', description: '新简介（可选）' },
  },
  ['volumeId'],
  async (args) => {
    const db = getDb()
    const vol = db.select({ id: volumes.id, title: volumes.title }).from(volumes).where(eq(volumes.id, args.volumeId)).get()
    if (!vol) return { error: '分卷不存在' }
    const updates: Record<string, any> = {}
    for (const key of ['title', 'description']) {
      if (args[key] !== undefined) updates[key] = args[key]
    }
    if (Object.keys(updates).length === 0) return { error: '未提供任何要更新的字段（title/description）' }
    return {
      pendingWrite: createPendingWrite({
        type: 'volume_info',
        title: `更新分卷《${vol.title}》`,
        summary: Object.keys(updates).join(', '),
        target: { volumeId: args.volumeId, entityType: 'volume' },
        applyMode: 'replace',
        data: updates,
        preview: { title: vol.title, summary: JSON.stringify(updates, null, 2) },
        riskLevel: 'medium',
      }),
    }
  },
)

// ─── 章节工具 ────────────────────────────────────────────────

const listChaptersTool = defineReadTool(
  'list_chapters',
  '查询书籍的所有章节，可按分卷筛选。bookId 不填则用当前选中书籍。',
  'chapter',
  {
    bookId: { type: 'string', description: '书籍 ID（可选）' },
    volumeId: { type: 'string', description: '分卷 ID（可选）' },
  },
  [],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const conditions = [eq(chapters.bookId, bookId)]
    if (args.volumeId) conditions.push(eq(chapters.volumeId, args.volumeId))
    const list = db.select({
      id: chapters.id,
      title: chapters.title,
      summary: chapters.summary,
      volumeId: chapters.volumeId,
      status: chapters.status,
      wordCount: chapters.wordCount,
      sortOrder: chapters.sortOrder,
    }).from(chapters).where(and(...conditions)).orderBy(asc(chapters.sortOrder)).all()
    return { data: list }
  },
)

const getChapterTool = defineReadTool(
  'get_chapter',
  '查询章节详细信息（含正文）。需要 chapterId。',
  'chapter',
  { chapterId: { type: 'string', description: '章节 ID' } },
  ['chapterId'],
  async (args) => {
    const db = getDb()
    const ch = db.select().from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    return { data: ch }
  },
)

const getChapterContentTool = defineReadTool(
  'get_chapter_content',
  '查询章节正文内容。写章节正文前，用于阅读上一章正文以确保衔接（场景、人物状态、悬念）。',
  'chapter',
  { chapterId: { type: 'string', description: '章节 ID' } },
  ['chapterId'],
  async (args) => {
    const db = getDb()
    const ch = db.select({ id: chapters.id, title: chapters.title, content: chapters.content, wordCount: chapters.wordCount, sortOrder: chapters.sortOrder }).from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    return { data: ch }
  },
)

const createChaptersTool = defineWriteTool(
  'create_chapters',
  '批量创建章节（仅标题/摘要/大纲，不含正文）。写正文用 write_chapter_content。创建后如需继续写正文，使用 is_prerequisite 参数标记。',
  'chapter',
  {
    chapters: {
      type: 'array',
      description: '章节列表，每项需包含 title/summary/outline',
      items: {
        type: 'object',
        description: '章节对象；title/summary/outline 全部必填',
        properties: {
          title: { type: 'string', description: '【必填】章节标题' },
          summary: { type: 'string', description: '【必填】章节摘要（本章的核心剧情概要）' },
          outline: { type: 'string', description: '【必填】章节大纲。结构规范见系统消息中的工具提示词。' },
          volumeId: { type: 'string', description: '（可选）所属分卷 ID' },
        },
        required: ['title', 'summary', 'outline'],
      },
    },
  },
  ['chapters'],
  async (args, ctx) => {
    const bookId = ctx.bookId
    if (!bookId) return { error: '当前无选中书籍' }
    // 防御性：确保 chapters 是数组
    const rawChapters: any[] = Array.isArray(args.chapters) ? args.chapters : []
    if (rawChapters.length === 0) return { error: 'chapters 参数为空或不是数组，无法创建章节' }

    // 服务端校验：确保每个章节都包含 title / summary / outline 三个非空字段。
    // JSON Schema 的 required 在很多本地/兼容模型上被忽略，因此这里做兜底并把缺失信息回注给模型，
    // 让 Agent 有机会重试补全（tool 返回 error → 下一轮模型会读到这个错误自行修正）。
    const missing: Array<{ index: number; missing: string[] }> = []
    rawChapters.forEach((c: any, idx: number) => {
      const miss: string[] = []
      if (!c || typeof c.title !== 'string' || !c.title.trim()) miss.push('title')
      if (!c || typeof c.summary !== 'string' || !c.summary.trim()) miss.push('summary')
      if (!c || typeof c.outline !== 'string' || !c.outline.trim()) miss.push('outline')
      if (miss.length > 0) missing.push({ index: idx, missing: miss })
    })
    if (missing.length > 0) {
      const detailsStr = missing.map(m => `第${m.index + 1}个章节缺失：${m.missing.join('、')}`).join('；')
      return {
        error: `有章节缺失必填字段，请补齐后重试。每个章节必须同时包含 title / summary / outline 三项，且都不能为空字符串。详情：${detailsStr}`,
      }
    }

    const chaptersArg = rawChapters
    return {
      pendingWrite: createPendingWrite({
        type: 'chapter_list',
        title: `创建 ${chaptersArg.length} 个章节`,
        summary: chaptersArg.map((c: any) => c?.title || '未命名').join('、'),
        target: { bookId, entityType: 'chapter' },
        applyMode: 'append',
        data: { items: chaptersArg },
        preview: { items: chaptersArg },
        riskLevel: 'low',
      }),
    }
  },
)

const writeChapterContentTool = defineWriteTool(
  'write_chapter_content',
  '写章节正文，生成待应用的正文内容。快照由用户在编辑器点"定稿"按钮手动触发。',
  'chapter',
  {
    chapterId: { type: 'string', description: '章节 ID' },
    content: { type: 'string', description: '章节正文内容。详细的写作规范见系统消息中的工具提示词。' },
    mode: { type: 'string', description: '写入模式', enum: ['append', 'replace'] },
  },
  ['chapterId', 'content'],
  async (args) => {
    const db = getDb()
    const ch = db.select({ id: chapters.id, title: chapters.title, content: chapters.content }).from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    const mode = args.mode || 'replace'
    // 防御性：content 必须是字符串
    const rawContent: string = typeof args.content === 'string' ? args.content : String(args.content ?? '')
    if (!rawContent) return { error: 'content 参数为空，无法写入章节正文' }
    // 工具阶段就把"章节标题 / 分段小标题 / 本章完"等残留清洗掉，让"结果确认"弹窗预览与最终落库一致
    const content = cleanEditorContentFromAi(rawContent, ch.title)
    if (!content) return { error: '正文清洗后为空，请检查模型输出' }
    return {
      pendingWrite: createPendingWrite({
        type: 'chapter_content',
        title: `${mode === 'append' ? '续写' : '重写'}章节《${ch.title}》`,
        summary: `${content.length} 字`,
        target: { chapterId: args.chapterId, entityType: 'chapter' },
        applyMode: mode as 'append' | 'replace',
        data: { content },
        preview: { title: ch.title, content: content.slice(0, 500) + (content.length > 500 ? '...' : '') },
        riskLevel: 'medium',
      }),
    }
  },
)

const updateChapterOutlineTool = defineWriteTool(
  'update_chapter_outline',
  '更新章节大纲，生成待应用的更新。',
  'chapter',
  {
    chapterId: { type: 'string', description: '章节 ID' },
    outline: { type: 'string', description: '新的章节大纲。结构规范见系统消息中的工具提示词。' },
  },
  ['chapterId', 'outline'],
  async (args) => {
    const db = getDb()
    const ch = db.select({ id: chapters.id, title: chapters.title }).from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    return {
      pendingWrite: createPendingWrite({
        type: 'chapter_outline',
        title: `更新章节《${ch.title}》大纲`,
        summary: args.outline.slice(0, 100) + '...',
        target: { chapterId: args.chapterId, entityType: 'chapter' },
        applyMode: 'replace',
        data: { outline: args.outline },
        preview: { title: ch.title, summary: args.outline.slice(0, 200) },
        riskLevel: 'low',
      }),
    }
  },
)

const updateChapterTool = defineWriteTool(
  'update_chapter',
  '更新章节的标题/摘要/状态（改大纲用 update_chapter_outline，改正文用 write_chapter_content），生成待应用的更新。',
  'chapter',
  {
    chapterId: { type: 'string', description: '章节 ID' },
    title: { type: 'string', description: '新标题（可选）' },
    summary: { type: 'string', description: '新摘要（可选）' },
    status: { type: 'string', description: '新状态（可选）', enum: ['draft', 'completed', 'finalized'] },
  },
  ['chapterId'],
  async (args) => {
    const db = getDb()
    const ch = db.select({ id: chapters.id, title: chapters.title }).from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    const updates: Record<string, any> = {}
    for (const key of ['title', 'summary', 'status']) {
      if (args[key] !== undefined) updates[key] = args[key]
    }
    if (Object.keys(updates).length === 0) return { error: '未提供任何要更新的字段（title/summary/status）' }
    return {
      pendingWrite: createPendingWrite({
        type: 'chapter_info',
        title: `更新章节《${ch.title}》`,
        summary: Object.keys(updates).join(', '),
        target: { chapterId: args.chapterId, entityType: 'chapter' },
        applyMode: 'replace',
        data: updates,
        preview: { title: ch.title, summary: JSON.stringify(updates, null, 2) },
        riskLevel: 'medium',
      }),
    }
  },
)

// ─── 大纲工具 ────────────────────────────────────────────────

const getBookOutlineTool = defineReadTool(
  'get_book_outline',
  '查询书籍总大纲。bookId 不填则用当前选中书籍。',
  'outline',
  { bookId: { type: 'string', description: '书籍 ID（可选）' } },
  [],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const outline = db.select().from(outlines).where(and(eq(outlines.bookId, bookId), eq(outlines.type, 'book'))).get()
    return { data: outline || { content: '' } }
  },
)

const writeBookOutlineTool = defineWriteTool(
  'write_book_outline',
  '写书籍总大纲，生成待应用的大纲内容。',
  'outline',
  {
    content: { type: 'string', description: '完整的大纲内容。详细的结构要求见系统消息中的工具提示词。' },
    mode: { type: 'string', description: '写入模式', enum: ['append', 'replace'] },
  },
  ['content'],
  async (args, ctx) => {
    const bookId = ctx.bookId
    if (!bookId) return { error: '当前无选中书籍' }
    const db = getDb()
    const book = db.select({ title: books.title }).from(books).where(eq(books.id, bookId)).get()
    const mode = args.mode || 'replace'
    // 防御性：content 必须是字符串
    const content: string = typeof args.content === 'string' ? args.content : String(args.content ?? '')
    if (!content) return { error: 'content 参数为空，无法写入书籍大纲' }
    return {
      pendingWrite: createPendingWrite({
        type: 'book_outline',
        title: `${mode === 'append' ? '追加' : '重写'}书籍《${book?.title || ''}》大纲`,
        summary: `${content.length} 字`,
        target: { bookId, entityType: 'outline' },
        applyMode: mode as 'append' | 'replace',
        data: { content },
        preview: { content: content.slice(0, 500) + (content.length > 500 ? '...' : '') },
        riskLevel: 'medium',
      }),
    }
  },
)

// ─── 设定工具 ────────────────────────────────────────────────

const SETTING_TYPES = ['characters', 'locations', 'items', 'skills', 'scenes', 'factions', 'systems', 'inspirations', 'foreshadowings']

const listSettingsTool = defineReadTool(
  'list_settings',
  '查询书籍的设定条目（角色/地点/物品等）。需要 type 参数。',
  'setting',
  {
    bookId: { type: 'string', description: '书籍 ID（可选）' },
    type: { type: 'string', description: '设定类型', enum: SETTING_TYPES },
  },
  ['type'],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const list = db.select().from(bookSettingEntries).where(and(eq(bookSettingEntries.bookId, bookId), eq(bookSettingEntries.type, args.type))).all()
    return { data: list }
  },
)

const createSettingsTool = defineWriteTool(
  'create_settings',
  '批量创建设定条目（角色/地点/物品等），生成待应用的设定列表。',
  'setting',
  {
    type: { type: 'string', description: '设定类型', enum: SETTING_TYPES },
    items: {
        type: 'array',
        description: '设定条目列表，每项必须同时包含 name/description/detail 三个字段',
        items: {
          type: 'object',
          description: '设定条目；name/description/detail 全部必填',
          properties: {
            name: { type: 'string', description: '【必填】名称' },
            description: { type: 'string', description: '【必填】简介' },
            detail: { type: 'string', description: '【必填】详细描述' },
          },
          required: ['name', 'description', 'detail'],
        },
      },
  },
  ['type', 'items'],
  async (args, ctx) => {
    const bookId = ctx.bookId
    if (!bookId) return { error: '当前无选中书籍' }
    // 防御性：确保 items 是数组
    const items: any[] = Array.isArray(args.items) ? args.items : []
    if (items.length === 0) return { error: 'items 参数为空或不是数组，无法创建设定条目' }
    return {
      pendingWrite: createPendingWrite({
        type: 'book_setting',
        title: `创建 ${items.length} 个${settingTypeLabel(args.type)}`,
        summary: items.map((i: any) => i?.name || '未命名').join('、'),
        target: { bookId, settingType: args.type, entityType: 'setting' },
        applyMode: 'append',
        data: { type: args.type, items },
        preview: { items },
        riskLevel: 'low',
      }),
    }
  },
)

const getSettingTool = defineReadTool(
  'get_setting',
  '查询单个设定条目的详细信息（名称/简介/详细描述/类型）。需要 settingId。',
  'setting',
  { settingId: { type: 'string', description: '设定条目 ID' } },
  ['settingId'],
  async (args) => {
    const db = getDb()
    const entry = db.select().from(bookSettingEntries).where(eq(bookSettingEntries.id, args.settingId)).get()
    if (!entry) return { error: '设定条目不存在' }
    return { data: entry }
  },
)

const updateSettingTool = defineWriteTool(
  'update_setting',
  '更新设定条目（角色/地点/物品等）的名称/简介/详细描述，生成待应用的更新。',
  'setting',
  {
    settingId: { type: 'string', description: '设定条目 ID' },
    name: { type: 'string', description: '新名称（可选）' },
    description: { type: 'string', description: '新简介（可选）' },
    detail: { type: 'string', description: '新详细描述（可选）' },
  },
  ['settingId'],
  async (args) => {
    const db = getDb()
    const entry = db.select({ id: bookSettingEntries.id, name: bookSettingEntries.name, type: bookSettingEntries.type }).from(bookSettingEntries).where(eq(bookSettingEntries.id, args.settingId)).get()
    if (!entry) return { error: '设定条目不存在' }
    const updates: Record<string, any> = {}
    for (const key of ['name', 'description', 'detail']) {
      if (args[key] !== undefined) updates[key] = args[key]
    }
    if (Object.keys(updates).length === 0) return { error: '未提供任何要更新的字段（name/description/detail）' }
    return {
      pendingWrite: createPendingWrite({
        type: 'setting_info',
        title: `更新${settingTypeLabel(entry.type)}《${entry.name}》`,
        summary: Object.keys(updates).join(', '),
        target: { settingId: args.settingId, entityType: 'setting' },
        applyMode: 'replace',
        data: updates,
        preview: { title: entry.name, summary: JSON.stringify(updates, null, 2) },
        riskLevel: 'medium',
      }),
    }
  },
)

const deleteEntityTool = defineWriteTool(
  'delete_entity',
  '【高风险】删除实体（书籍/分卷/章节/设定）。仅当用户明确要求删除/清空/重建/覆盖时调用。',
  'system',
  {
    entityType: { type: 'string', description: '实体类型', enum: ['book', 'volume', 'chapter', 'setting'] },
    entityIds: { type: 'array', description: '实体 ID 列表', items: { type: 'string', description: 'ID' } },
  },
  ['entityType', 'entityIds'],
  async (args) => {
    // 防御性：确保 entityIds 是数组
    const entityIds: string[] = Array.isArray(args.entityIds) ? args.entityIds : []
    if (entityIds.length === 0) return { error: 'entityIds 参数为空或不是数组，无法删除' }
    const entityTypeCN: Record<string, string> = {
      book: '书籍',
      volume: '分卷',
      chapter: '章节',
      setting: '设定',
    }
    return {
      pendingWrite: createPendingWrite({
        type: 'delete_entity',
        title: `删除 ${entityIds.length} 个${entityTypeCN[args.entityType as string] || args.entityType}`,
        summary: `${entityIds.length} 项待删除`,
        target: { entityType: args.entityType, entityIds },
        applyMode: 'none',
        data: { entityType: args.entityType, entityIds },
        riskLevel: 'high',
      }),
    }
  },
)

// ─── 导出所有工具 ─────────────────────────────────────────────

export const crudTools = [
  listBooksTool,
  getBookTool,
  createBookTool,
  updateBookTool,
  listVolumesTool,
  getVolumeTool,
  createVolumesTool,
  updateVolumeTool,
  updateVolumeOutlineTool,
  listChaptersTool,
  getChapterTool,
  getChapterContentTool,
  createChaptersTool,
  writeChapterContentTool,
  updateChapterTool,
  updateChapterOutlineTool,
  getBookOutlineTool,
  writeBookOutlineTool,
  listSettingsTool,
  getSettingTool,
  createSettingsTool,
  updateSettingTool,
  deleteEntityTool,
]
