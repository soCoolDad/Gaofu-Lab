/**
 * 采样参数（temperature / top_p / frequency_penalty / presence_penalty）的统一读取与兜底。
 *
 * 数据来源有两处：
 *   1. 模型级：「模型管理 → 编辑模型 → 采样参数」→ model_providers 的
 *      temperature / top_p / frequency_penalty / presence_penalty 列；
 *   2. 任务级：「设置 → 任务默认模型参数」→ ai_settings.data.taskSampling（本文件读写）。
 *      每个任务可选「跟随模型」或「自定义」。
 *
 * 历史问题（"模型编辑保存后采样参数丢失"）：模型列只在模型管理页读写，从没被带进模型请求体
 * （model-caller 的 worker buildBody 只发 temperature，且各调用点写死任务温度），
 * 于是用户"保存了采样参数却像丢了"。现在全链路统一走本文件。
 *
 * 取值优先级（逐字段回退，越靠前越优先）：
 *   任务自定义值  >  模型行配置值  >  任务内置默认
 * （仅 temperature 有内置默认；top_p / 惩罚项没有内置默认——都没配就"不发送"，交 provider 默认）
 * 因此：
 *   - 任务选「跟随模型」= 不做任务级覆盖，直接用模型行（模型没配温度则用该任务内置默认）；
 *   - 任务「自定义」里留空的项 = 该项仍跟随模型（UI 上的 placeholder 就是「跟随模型」）。
 */

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { aiSettings } from '../db/schema'

// ─── 任务注册表（渲染层通过 settings:getSamplingTasks 读取，单一数据源，避免两处维护） ───

export type SamplingTaskKey =
  | 'agentIntention'
  | 'agentReply'
  | 'chatRoom'
  | 'roleDialogueSnippet'
  | 'roleDialogueSummary'
  | 'memorySnapshot'
  | 'styleSummary'
  | 'skill'

export type SamplingTaskMeta = {
  key: SamplingTaskKey
  /** 面板上显示的任务名 */
  label: string
  /** 该任务在做什么 / 为什么建议这个温度 */
  description: string
  /** 任务内置默认温度：模型行与任务自定义都没配时使用（与接入前各调用点写死的值保持一致） */
  defaultTemperature: number
}

/** 所有会调用模型的业务任务。新增任务时：在此登记 → 调用处用 resolveSamplingParams(model, key) 取参数。 */
export const SAMPLING_TASKS: SamplingTaskMeta[] = [
  {
    key: 'agentIntention',
    label: '「知卷」意图分析',
    description: '判断这次请求该调用哪些工具、该改哪一章。结构化输出，温度建议偏低以保证稳定。',
    defaultTemperature: 0.7,
  },
  {
    key: 'agentReply',
    label: '「知卷」回复生成',
    description: '知卷的主对话与工具调用轮次（含写章节正文）。创作类请求，温度可略高。',
    defaultTemperature: 0.7,
  },
  {
    key: 'chatRoom',
    label: '角色聊天室',
    description: '角色们接龙发言（写台词）。需要较高随机性，避免所有角色口吻趋同。',
    defaultTemperature: 0.9,
  },
  {
    key: 'roleDialogueSnippet',
    label: '剧情预演 · 片段扩写',
    description: '把零散的对话片段扩写成一段有画面的剧情。',
    defaultTemperature: 0.85,
  },
  {
    key: 'roleDialogueSummary',
    label: '剧情预演 · 剧情总结',
    description: '把多个片段融合成连贯剧情，并顺带修正错别字 / 逻辑 / 人称错误。',
    defaultTemperature: 0.7,
  },
  {
    key: 'memorySnapshot',
    label: '章节记忆分析',
    description: '生成单章结构化记忆 JSON（角色状态、地点场景、伏笔、出场切片）。必须稳定，温度建议偏低。',
    defaultTemperature: 0.3,
  },
  {
    key: 'styleSummary',
    label: '文风指纹摘要',
    description: '把量化文风特征总结成几条带数字锚点的硬约束。结构化输出，温度建议偏低。',
    defaultTemperature: 0.3,
  },
  {
    key: 'skill',
    label: '技能处理',
    description: '「技能」面板用你配置的提示词处理选中的文本（润色、改写、扩写等）。',
    defaultTemperature: 0.6,
  },
]

const TASK_META_BY_KEY: Record<string, SamplingTaskMeta> = SAMPLING_TASKS.reduce((acc, task) => {
  acc[task.key] = task
  return acc
}, {} as Record<string, SamplingTaskMeta>)

// ─── 类型 ───

/** 一次调用的采样参数（可直接展开进 AgentModelPayload） */
export type SamplingParams = {
  temperature: number
  topP: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
}

/** 采样参数来源：model_providers 行、decodeModelApiKey(row) 的结果，或 AgentModelConfig / ResolvedModel */
export type SamplingSource = {
  temperature?: number | null
  topP?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
}

/** 单个任务的采样参数配置（mode='follow' 时数值字段被忽略，即"跟随模型"） */
export type TaskSamplingConfig = {
  mode: 'follow' | 'custom'
  temperature?: number | null
  topP?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
}

export type TaskSamplingSettings = Record<string, TaskSamplingConfig>

// ─── 工具 ───

/** 只接受有限数字；null / undefined / '' / NaN / Infinity → null（0 是合法值，必须保留） */
function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const AI_SETTINGS_ID = 'default'

/**
 * 读取「设置 → 任务默认模型参数」的配置。
 * 每次调用都读库（而不是缓存）：改完设置后下一次模型调用立即生效，无需重启。
 * 读取失败（无库 / 无记录 / JSON 损坏）一律返回空对象（= 全部跟随模型），不影响正常调用。
 */
export function readTaskSamplingSettings(): TaskSamplingSettings {
  try {
    const row = getDb().select({ data: aiSettings.data })
      .from(aiSettings)
      .where(eq(aiSettings.id, AI_SETTINGS_ID))
      .get()
    if (!row?.data) return {}
    const parsed = JSON.parse(row.data) as { taskSampling?: unknown }
    const raw = parsed?.taskSampling
    if (!raw || typeof raw !== 'object') return {}
    const out: TaskSamplingSettings = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      out[key] = {
        mode: v.mode === 'custom' ? 'custom' : 'follow',
        temperature: toFiniteOrNull(v.temperature),
        topP: toFiniteOrNull(v.topP),
        frequencyPenalty: toFiniteOrNull(v.frequencyPenalty),
        presencePenalty: toFiniteOrNull(v.presencePenalty),
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 任务内置默认温度（注册表里没有的 key 兜底 0.7） */
export function getTaskDefaultTemperature(task: SamplingTaskKey): number {
  return TASK_META_BY_KEY[task]?.defaultTemperature ?? 0.7
}

/**
 * 计算一次模型调用的采样参数。
 * @param model 模型行 / 已解码 model / AgentModelConfig（缺字段视为未配置）
 * @param task 任务 key（见 SAMPLING_TASKS）：取「设置 → 任务默认模型参数」里的自定义值与内置默认温度。
 */
export function resolveSamplingParams(
  model: SamplingSource | null | undefined,
  task: SamplingTaskKey,
): SamplingParams {
  const override = readTaskSamplingSettings()[task]
  // mode='follow'（或没配置该任务）时不做任务级覆盖
  const custom = override && override.mode === 'custom' ? override : null
  return {
    temperature: toFiniteOrNull(custom?.temperature)
      ?? toFiniteOrNull(model?.temperature)
      ?? getTaskDefaultTemperature(task),
    topP: toFiniteOrNull(custom?.topP) ?? toFiniteOrNull(model?.topP),
    frequencyPenalty: toFiniteOrNull(custom?.frequencyPenalty) ?? toFiniteOrNull(model?.frequencyPenalty),
    presencePenalty: toFiniteOrNull(custom?.presencePenalty) ?? toFiniteOrNull(model?.presencePenalty),
  }
}
