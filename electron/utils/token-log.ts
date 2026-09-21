/**
 * Token 消耗记账（共享工具）。
 *
 * 各业务模块（chat-room / role-dialogue / agent）此前各自内联 writeTokenLog，
 * 这里抽出口径完全一致的公共实现供新模块复用：
 *   - normalizeRawUsage：把 provider 原始 usage（snake/camel、details 子对象）归一化
 *   - computeUsageCost：缓存命中/未命中/输出三段计费（口径与聊天室一致）
 *   - insertTokenLog：落 token_usage_logs 表
 */

import { getSqlite } from '../db'
import { v4 as uuidv4 } from 'uuid'
import { resolveCurrentPrices } from './billing'

export type NormalizedUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedPromptTokens: number
  reasoningTokens: number
}

export function normalizeRawUsage(raw: any): NormalizedUsage {
  if (!raw) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, reasoningTokens: 0 }
  return {
    promptTokens: raw.prompt_tokens ?? raw.promptTokens ?? 0,
    completionTokens: raw.completion_tokens ?? raw.completionTokens ?? 0,
    totalTokens: raw.total_tokens ?? raw.totalTokens ?? 0,
    cachedPromptTokens:
      raw.prompt_tokens_details?.cached_tokens ?? raw.cached_prompt_tokens ?? raw.cachedPromptTokens ?? 0,
    reasoningTokens:
      raw.completion_tokens_details?.reasoning_tokens ?? raw.reasoning_tokens ?? raw.reasoningTokens ?? 0,
  }
}

/** 缓存命中数不应超过输入 token 数；供应商返回异常时钳制，避免未命中变负数 */
function clampCached(promptTokens: number, cachedPromptTokens: number): number {
  return Math.max(0, Math.min(cachedPromptTokens || 0, promptTokens || 0))
}

export function computeUsageCost(
  usage: NormalizedUsage,
  prices: { inputPrice?: number | null; outputPrice?: number | null; cachedInputPrice?: number | null; billingRules?: string | null },
): number {
  // 计费口径统一走 resolveCurrentPrices：如配置了计费规则且当前时刻命中，
  // 则按规则价格计算；未配置 / 未命中时回退到默认价格。
  const { prices: effective } = resolveCurrentPrices(prices)
  const inputPrice = effective.inputPrice
  const outputPrice = effective.outputPrice
  const cachedPrice = effective.cachedInputPrice
  const cachedTokens = clampCached(usage.promptTokens, usage.cachedPromptTokens)
  const missTokens = Math.max(0, (usage.promptTokens || 0) - cachedTokens)
  const missCost = (missTokens * inputPrice) / 1_000_000
  const cacheCost = (cachedTokens * cachedPrice) / 1_000_000
  const outputCost = ((usage.completionTokens || 0) * outputPrice) / 1_000_000
  return missCost + cacheCost + outputCost
}

export function hasUsableUsage(usage: NormalizedUsage): boolean {
  return (usage.promptTokens || 0) > 0 || (usage.completionTokens || 0) > 0 || (usage.totalTokens || 0) > 0
}

/** 落一条 token_usage_logs；写失败只打日志，不阻塞业务主流程 */
export function insertTokenLog(args: {
  modelId: string
  action: string
  contextType: string
  usage: NormalizedUsage
  cost: number
  bookId?: string | null
  bookTitle?: string | null
  systemRequestText?: string
  userRequestText?: string
  responseText?: string
}): void {
  try {
    const { usage } = args
    getSqlite().prepare(
      `INSERT INTO token_usage_logs (
        id, book_id, chapter_id, volume_id, model_id, action, context_type,
        prompt_tokens, completion_tokens, total_tokens,
        cached_prompt_tokens, reasoning_tokens, cost, calls,
        book_title, request_text, system_request_text, user_request_text, response_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuidv4(),
      args.bookId ?? null,
      null,
      null,
      args.modelId,
      args.action,
      args.contextType,
      usage.promptTokens || 0,
      usage.completionTokens || 0,
      usage.totalTokens || 0,
      usage.cachedPromptTokens || 0,
      usage.reasoningTokens || 0,
      args.cost,
      args.bookTitle ?? null,
      `${(args.systemRequestText || '').slice(0, 200)}\n...\n${(args.userRequestText || '').slice(0, 200)}`,
      (args.systemRequestText || '').slice(0, 2000),
      (args.userRequestText || '').slice(0, 2000),
      (args.responseText || '').slice(0, 2000),
      new Date().toISOString(),
    )
  } catch (err) {
    console.error('[token-log] 写入失败:', err)
  }
}
