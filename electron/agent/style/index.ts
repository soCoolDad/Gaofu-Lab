/**
 * 文风指纹模块汇总
 *
 * 对外暴露四个能力：
 *   - getActiveStyleSummary(bookId)：取激活指纹的约束摘要（注入 prompt 用）
 *   - getActiveStyleFingerprint(bookId)：取激活指纹全量（含 metrics）
 *   - auditChapterContent(bookId, content)：正文对照激活指纹算吻合度（工具阶段用）
 *   - extractAndSummarize(...)：提取 metrics + 生成摘要（IPC 提取流程用）
 */

import { eq, and } from 'drizzle-orm'
import { getDb } from '../../db'
import { styleFingerprints } from '../../db/schema'
import { extractMetrics, type StyleMetrics } from './extractor'
import { generateStyleSummary } from './summary'
import { auditContent, type AuditResult } from './auditor'

export type ActiveStyleFingerprint = {
  id: string
  name: string
  metrics: StyleMetrics
  summary: string
}

type StyleFingerprintRow = typeof styleFingerprints.$inferSelect

/** 把 DB 行还原成结构化指纹 */
function rowToFingerprint(row: StyleFingerprintRow): ActiveStyleFingerprint {
  let metrics: StyleMetrics
  try {
    metrics = JSON.parse(row.metrics) as StyleMetrics
  } catch {
    metrics = extractMetrics([]) // 兜底空 metrics
  }
  return { id: row.id, name: row.name, metrics, summary: row.summary }
}

/** 取指定 id 的指纹（用于"按场景勾选"——写作时传入具体指纹 id）。无摘要则返回 null。 */
export function getStyleFingerprintById(id: string | null | undefined): ActiveStyleFingerprint | null {
  if (!id) return null
  const db = getDb()
  const row = db.select().from(styleFingerprints).where(eq(styleFingerprints.id, id)).get()
  if (!row || !row.summary) return null
  return rowToFingerprint(row)
}

/**
 * 取写作注入用的文风摘要：
 *   - 传入 fingerprintId 时优先用它（"按场景勾选"）；
 *   - 否则回退到本书激活指纹（isDefault）。
 * 无可用摘要返回 null。
 */
export function getWritingStyleSummary(bookId: string | null | undefined, fingerprintId?: string | null): string | null {
  if (fingerprintId) {
    const fp = getStyleFingerprintById(fingerprintId)
    if (fp?.summary) return fp.summary
  }
  return getActiveStyleSummary(bookId)
}

/** 取某书当前激活的指纹（isDefault=true）。无则 null。 */
export function getActiveStyleFingerprint(bookId: string | null | undefined): ActiveStyleFingerprint | null {
  if (!bookId) return null
  const db = getDb()
  const row = db
    .select()
    .from(styleFingerprints)
    .where(and(eq(styleFingerprints.bookId, bookId), eq(styleFingerprints.isDefault, true)))
    .get()
  if (!row || !row.summary) return null
  return rowToFingerprint(row)
}

/** 取激活指纹的约束摘要文本（注入 prompt 用）。无激活指纹或无摘要则 null。 */
export function getActiveStyleSummary(bookId: string | null | undefined): string | null {
  const fp = getActiveStyleFingerprint(bookId)
  return fp?.summary || null
}

/** 正文对照激活指纹算吻合度。无激活指纹返回 null（调用方应跳过校验）。 */
export function auditChapterContent(bookId: string | null | undefined, content: string): AuditResult | null {
  const fp = getActiveStyleFingerprint(bookId)
  if (!fp) return null
  return auditContent(fp.metrics, content)
}

/**
 * 提取 + 生成摘要（IPC 提取流程调用）。
 * 返回 metrics 与 summary，由 IPC 层负责落库。
 */
export async function extractAndSummarize(opts: {
  samples: Array<{ title?: string; content: string }>
  fingerprintName: string
  modelId: string
  onReasoning?: (delta: string) => void
  bookId?: string | null
  bookTitle?: string | null
}): Promise<{ metrics: StyleMetrics; summary: string }> {
  const metrics = extractMetrics(opts.samples)
  const summary = await generateStyleSummary({
    metrics,
    samples: opts.samples,
    fingerprintName: opts.fingerprintName,
    modelId: opts.modelId,
    onReasoning: opts.onReasoning,
    bookId: opts.bookId,
    bookTitle: opts.bookTitle,
  })
  return { metrics, summary }
}

export { extractMetrics, metricsToReadable, AI_CLICHE_GROUPS } from './extractor'
export { auditContent } from './auditor'
export type { StyleMetrics } from './extractor'
export type { AuditResult, AuditDimension, AuditStatus } from './auditor'
