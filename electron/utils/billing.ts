/**
 * 计费规则解析器（共享工具）。
 *
 * 项目里此前每个模型都能配三条默认单价（inputPrice / outputPrice / cachedInputPrice），
 * 但"计费规则"（按星期几 + 时间段覆盖）只在前端展示、后端从未消费——用户设置的高峰/低峰时段
 * 从未真正生效。这里抽出单一权威实现，把"当前该收多少钱"的判断集中到这一处。
 *
 * 语义：
 *   1. 未配置 billingRules（或为空 / 解析失败 / 无一条命中当前时刻）→ 使用模型默认单价；
 *   2. 命中规则 → 规则内已填的价格字段生效；未填的字段回退到模型默认值；
 *      规则里显式写 0 也视为 0（尊重用户的"这段免费"配置）。
 *
 * 时间粒度：HH:mm 字符串比较。规则覆盖跨 00:00 的夜间时段（如 22:00~06:00）
 * 用户需拆成两条规则；前端校验器已保证同一天内规则首尾相接、不重叠。
 */

import type { BillingRule, EffectivePrices } from './billing.types'

/** 从 model_providers.billing_rules 文本列解析规则数组；解析失败返回 null（走默认单价） */
export function parseBillingRules(raw: unknown): BillingRule[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const rules: BillingRule[] = parsed.filter(
      (r: any) => r && typeof r === 'object' && typeof r.startTime === 'string' && typeof r.endTime === 'string',
    )
    return rules.length > 0 ? rules : null
  } catch {
    return null
  }
}

/** HH:mm 时间字符串格式校验（用于跳过脏数据，避免 'undefined' < '00:00' 误判为命中） */
function isValidHM(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** 当前本地时间的 HH:mm 字符串（保留零填充，可直接与规则字符串比较） */
export function currentHHMM(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * 从规则列表中挑出当前生效的规则，并返回其生效后的单价（缺省字段回退到 defaultPrices）。
 *
 * 若没有规则命中，返回的 effective 字段为 false，prices 为 defaultPrices 的规范化结果。
 */
export function resolvePricesFromRules(
  rules: BillingRule[] | null | undefined,
  defaultPrices: { inputPrice?: number | null; outputPrice?: number | null; cachedInputPrice?: number | null },
  at: Date = new Date(),
): { effective: boolean; rule: BillingRule | null; prices: EffectivePrices } {
  const baseInput = Number(defaultPrices.inputPrice ?? 0) || 0
  const baseOutput = Number(defaultPrices.outputPrice ?? 0) || 0
  const baseCached =
    defaultPrices.cachedInputPrice == null
      ? baseInput
      : Number(defaultPrices.cachedInputPrice) || 0

  const base: EffectivePrices = { inputPrice: baseInput, outputPrice: baseOutput, cachedInputPrice: baseCached }

  if (!rules || rules.length === 0) return { effective: false, rule: null, prices: base }

  // 星期几：JS getDay 0=Sun..6=Sat；规则约定 1=Mon..7=Sun。
  const jsDay = at.getDay()
  const ruleDay = jsDay === 0 ? 7 : jsDay
  const nowHM = currentHHMM(at)

  for (const rule of rules) {
    if (!Array.isArray(rule.days) || rule.days.length === 0) continue
    if (!rule.days.includes(ruleDay)) continue
    const start = rule.startTime || ''
    const end = rule.endTime || ''
    if (!isValidHM(start) || !isValidHM(end)) continue
    // HH:mm 字符串比较在同一天内是可靠的（同格式定宽字符串）
    if (nowHM < start || nowHM > end) continue

    // 命中：规则已填的字段生效，未填的回退默认值；显式 0 视为 0
    const normField = (v: unknown, fallback: number): number => {
      if (v === null || v === undefined) return fallback
      const n = Number(v)
      if (!Number.isFinite(n)) return fallback
      return n
    }
    const prices: EffectivePrices = {
      inputPrice: normField(rule.inputPrice, base.inputPrice),
      outputPrice: normField(rule.outputPrice, base.outputPrice),
      cachedInputPrice: normField(rule.cachedInputPrice, base.cachedInputPrice),
    }
    return { effective: true, rule, prices }
  }

  return { effective: false, rule: null, prices: base }
}

/**
 * 便捷入口：传入 model_providers 行（或已解码模型对象），返回此刻生效的单价。
 * 未配置或无规则命中时返回 defaultPrices 的规范化结果。
 */
export function resolveCurrentPrices(
  row: {
    inputPrice?: number | null
    outputPrice?: number | null
    cachedInputPrice?: number | null
    billingRules?: string | null
  },
  at: Date = new Date(),
): { effective: boolean; rule: BillingRule | null; prices: EffectivePrices } {
  const rules = parseBillingRules(row.billingRules)
  return resolvePricesFromRules(rules, row, at)
}

/**
 * 模型调用前的强校验：如果模型没有配置计费规则，直接抛错，避免"没算清账就烧钱"。
 *
 * 场景：用户在「模型管理」里创建了模型但忘了填计费规则；如果放行，一次长对话可能默默烧掉
 * 几毛钱而界面看不到任何提示。这里 fail-fast，用统一的中文报错让 UI 层能直接弹给用户。
 *
 * 判定口径与 parseBillingRules 一致：null / 空字符串 / 解析失败 / 空数组都视为"未配置"。
 * 规则存在但当前时刻不命中不算未配置（回退到默认单价仍可能收费，让用户明确知情后再调）。
 */
export function assertBillingRulesConfigured(
  row: { billingRules?: string | null; name?: string | null; modelName?: string | null },
): void {
  const rules = parseBillingRules(row.billingRules)
  if (rules) return
  const label = row.name || row.modelName || '当前模型'
  throw new Error(
    `「${label}」未配置计费规则，已阻止本次模型调用以避免未预估成本。\n` +
    `请到「模型管理」→ 该模型 → 编辑，至少配置一条按星期几 + 时间段的计费规则后再使用。`,
  )
}
