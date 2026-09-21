/**
 * 计费规则的类型定义（前后端可复用）。
 *
 * 与 src/pages/Models/index.tsx 中「编辑模型弹窗」表单字段一致：
 *   days: 1=周一..7=周日；startTime / endTime: 'HH:mm'。
 */

export interface BillingRule {
  /** 规则名称（如"工作日下午高峰"），仅用于展示 */
  name?: string
  /** 适用星期：1=周一…7=周日 */
  days?: number[]
  /** 开始时间 'HH:mm'（含） */
  startTime?: string | null
  /** 结束时间 'HH:mm'（含） */
  endTime?: string | null
  /** 输入价（元/百万 token），规则未填 → 使用模型默认值 */
  inputPrice?: number | null
  /** 输出价（元/百万 token），规则未填 → 使用模型默认值 */
  outputPrice?: number | null
  /** 缓存命中价（元/百万 token），规则未填 → 使用模型默认缓存价（缺省再退到输入价） */
  cachedInputPrice?: number | null
}

export interface EffectivePrices {
  inputPrice: number
  outputPrice: number
  cachedInputPrice: number
}
