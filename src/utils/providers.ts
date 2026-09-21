/**
 * 供应商 / 模型的展示标签工具。
 *
 * 项目里所有模型都是「供应商 + 模型 ID」的组合；同一 modelName（如 "deepseek-chat"）
 * 在不同供应商下可能都存在。为了让"选择模型"的下拉里能一眼看出这条模型属于哪家，
 * 统一在这里维护 provider → 中文标签的映射，以及拼接出「供应商/模型名」的展示串。
 *
 * 用法：
 *   import { modelFullName } from '@/utils/providers'
 *   options={models.map(m => ({ value: m.id, label: modelFullName(m) }))}
 */

export interface ProviderPlan {
  /** provider 主键（例如 'deepseek'） */
  provider: string
  /** 面向用户展示的中文 / 英文标签（例如 'DeepSeek'） */
  label: string
  /** 默认 Base URL，添加新模型时自动填 */
  baseUrl: string
}

/** 内置供应商列表：key 是"添加模型"弹窗的选项键，不是 provider 字段本身 */
export const PROVIDER_PLANS: Record<string, ProviderPlan> = {
  'deepseek': { provider: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  'huoshan-general': { provider: 'huoshan', label: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  'qwen': { provider: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuacs.com/compatible-mode/v1' },
  'zhipu': { provider: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  'moonshot': { provider: 'moonshot', label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  'baidu-qianfan': { provider: 'baidu-qianfan', label: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2' },
  'tencent-hunyuan': { provider: 'tencent-hunyuan', label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  'minimax': { provider: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
  'stepfun': { provider: 'stepfun', label: '阶跃星辰 Step', baseUrl: 'https://api.stepfun.com/v1' },
  'zero-one': { provider: 'zero-one', label: '零一万物 Yi', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  'siliconflow': { provider: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  'openai-compatible': { provider: 'openai-compatible', label: '自定义 / OpenAI 协议', baseUrl: '' },
}

/**
 * 把 model 上的 provider 字段（后端存的是主键，如 'deepseek'）映射成展示标签。
 * 兼容两种情况：
 *   1. 直接匹配 plan.provider（'deepseek' → 'DeepSeek'）
 *   2. 回退到 plan.key（'huoshan-general' → '火山方舟'）
 * 都匹配不到就用 provider 原值。
 */
export function getProviderLabel(provider: string | null | undefined): string {
  if (!provider) return '未知供应商'
  const plan = Object.values(PROVIDER_PLANS).find((p) => p.provider === provider)
  return plan?.label || provider
}

/** 便捷拼接：`供应商标签 / 模型名`，例如 "DeepSeek / deepseek-chat" */
export function modelFullName(
  model: { name?: string | null; provider?: string | null; modelName?: string | null } | null | undefined,
): string {
  if (!model) return '未知模型'
  const name = model.name || model.modelName || '未命名'
  const label = getProviderLabel(model.provider)
  return `${label} / ${name}`
}
