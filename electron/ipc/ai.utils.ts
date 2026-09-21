import { and, eq, gte, isNull, like, or } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { books, chapters, volumes, tokenUsageLogs } from '../db/schema'
import type { DecodedModel } from './model.ipc'
import type { TokenLogFilterData, PromptCacheEntry } from './ai.types'
import { resolveCurrentPrices } from '../utils/billing'

// ─── 常用工具函数 ───────────────────────────────────────────

export function now(): string {
  return new Date().toISOString()
}

export function getSourceHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (text.match(/[a-zA-Z0-9_]+/g) || []).length
  const other = Math.max(0, text.length - chinese - words)
  return Math.ceil(chinese * 0.6 + words * 1.3 + other * 0.3)
}

export function compactOneLine(value?: string | null, limit = 80): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').slice(0, limit)
}

export function parseChineseNumber(value: string): number | null {
  const numMap: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  }
  if (numMap[value] !== undefined) return numMap[value]
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

export function uniqueValues<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>()
  items.forEach((item) => map.set(item.id, item))
  return Array.from(map.values())
}

// ─── 排序 ──────────────────────────────────────────────────

export function sortVolumesList(items: (typeof volumes.$inferSelect)[]): (typeof volumes.$inferSelect)[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

export function sortChaptersList(items: (typeof chapters.$inferSelect)[]): (typeof chapters.$inferSelect)[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

// ─── Token 日志辅助 ────────────────────────────────────────

export function todayStart(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function rangeStart(range?: TokenLogFilterData['range']): string | null {
  if (!range || range === 'all') return null
  const d = new Date()
  if (range === 'today') {
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  if (range === 'week') {
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  if (range === 'month') {
    d.setMonth(d.getMonth() - 1)
    return d.toISOString()
  }
  return null
}

export function buildTokenLogWhere(data?: TokenLogFilterData) {
  const conditions: any[] = []
  const start = rangeStart(data?.range || 'today')
  if (start) conditions.push(gte(tokenUsageLogs.createdAt, start))
  if (data?.modelId) conditions.push(eq(tokenUsageLogs.modelId, data.modelId))
  // 作品过滤：按书名精确匹配。写入时已存书名快照 book_title（删书后 book_id 置 NULL 但快照保留，
  // 仍可筛出）；老记录书名为空时，回退到 books.title（主查询已 LEFT JOIN books，故可直接用）。
  if (data?.bookTitle) {
    conditions.push(or(
      eq(tokenUsageLogs.bookTitle, data.bookTitle),
      and(isNull(tokenUsageLogs.bookTitle), eq(books.title, data.bookTitle)),
    ))
  }
  // 动作过滤：按写入的中文动作标签（如"对话""生成章节记忆"）过滤。注意 action 列可能是组合
  // 字符串（"创建章节 + 写作正文"），因此既要精确匹配单个动作，也要匹配组合中的子动作。
  if (data?.action) {
    conditions.push(
      or(
        eq(tokenUsageLogs.action, data.action),
        like(tokenUsageLogs.action, `${data.action} + %`),
        like(tokenUsageLogs.action, `% + ${data.action} + %`),
        like(tokenUsageLogs.action, `% + ${data.action}`),
      ),
    )
  }
  return conditions.length > 0 ? and(...conditions) : undefined
}

// ─── Cost 计算 ─────────────────────────────────────────────

export function calcCost(
  promptTokens: number,
  completionTokens: number,
  model: DecodedModel,
  cachedPromptTokens: number = 0,
): number {
  // 计费价格：优先使用当前时刻命中的计费规则；无规则命中时回退到默认单价
  const { prices: p } = resolveCurrentPrices(model)
  const inputPrice = p.inputPrice
  const outputPrice = p.outputPrice
  const cachedPrice = p.cachedInputPrice
  const cached = Math.min(Math.max(cachedPromptTokens || 0, 0), promptTokens)
  const uncachedPrompt = promptTokens - cached
  return (uncachedPrompt / 1_000_000) * inputPrice
    + (cached / 1_000_000) * cachedPrice
    + (completionTokens / 1_000_000) * outputPrice
}

// ─── Prompt 缓存（内存） ───────────────────────────────────

const promptCache = new Map<string, PromptCacheEntry>()

export function clearPromptCacheMemo(): void {
  promptCache.clear()
}
