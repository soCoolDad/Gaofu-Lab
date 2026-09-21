/**
 * 文风摘要生成器
 *
 * 职责：把提取器算出的量化 metrics + 范本片段，交给模型生成一段
 *   "可直接注入写作 prompt 的硬约束摘要"。
 *
 * 关键：摘要必须带数字锚点（句长 X 字 / 对话占比 X%），禁止空泛
 *   （"轻松幽默"这种笼统词一律不要——那正是现在 AI 味重的根因）。
 *   并把范本中本来就没有的 AI 套路词列成"禁止使用"清单。
 *
 * 调用一次模型，per-指纹，非高频路径，不影响 prompt-prefix 缓存。
 */

import { eq } from 'drizzle-orm'
import { runAgentModel } from '../model-caller'
import { decodeModelApiKey } from '../../ipc/model.ipc'
import { getDb } from '../../db'
import { modelProviders } from '../../db/schema'
import { metricsToReadable, AI_CLICHE_GROUPS, type StyleMetrics } from './extractor'
import { normalizeRawUsage, computeUsageCost, hasUsableUsage, insertTokenLog } from '../../utils/token-log'
import { assertBillingRulesConfigured } from '../../utils/billing'
import { resolveSamplingParams } from '../../utils/sampling'

/** 生成文风约束摘要（注入 prompt 用） */
export async function generateStyleSummary(opts: {
  metrics: StyleMetrics
  samples: Array<{ title?: string; content: string }>
  fingerprintName: string
  modelId: string
  onReasoning?: (delta: string) => void
  bookId?: string | null
  bookTitle?: string | null
}): Promise<string> {
  const { metrics, samples, fingerprintName, modelId, onReasoning, bookId, bookTitle } = opts

  const db = getDb()
  const modelRow = db.select().from(modelProviders).where(eq(modelProviders.id, modelId)).get()
  const model = decodeModelApiKey(modelRow)
  if (!modelRow || !model || !model.apiKey || !model.modelName) {
    throw new Error('模型配置不完整，无法生成文风摘要')
  }
  // 强校验：模型未配置计费规则则直接抛错，避免"未预估成本就调用"
  assertBillingRulesConfigured(modelRow)

  // 范本片段：每篇取前 600 字，最多 3 篇，控制 prompt 长度
  const snippets = samples
    .filter((s) => s.content && s.content.trim())
    .slice(0, 3)
    .map((s, i) => {
      const title = s.title || `范本${i + 1}`
      const body = s.content.replace(/\s+/g, ' ').slice(0, 600)
      return `【${title}】\n${body}`
    })
    .join('\n\n---\n\n')

  // 套路词总清单（用于"禁止使用"段，无论范本是否命中都注入，因为这是反 AI 味核心）
  const clicheWords = AI_CLICHE_GROUPS.map((g) => g.words.join('、')).join('\n')

  const systemPrompt = `你是文风分析师。任务：根据给定的量化统计特征与范本片段，生成一段「可直接注入小说写作提示词的文风硬约束摘要」。

# 输出要求
1. 输出纯文本，3~6 行，每行一条可执行的硬约束。不要 Markdown 标记，不要标题，不要解释。
2. 每条约束必须带具体数字锚点（句长 X 字、对话占比 X%、短句占比 X% 等），数字直接取自统计特征。
3. 严禁空泛形容词（"轻松幽默""严肃史诗""生动形象"这类一律不得出现）。
4. 必须包含一条「禁止使用以下 AI 高频套路词」清单，把范本中未出现或仅极少出现的套路词列入。
5. 用词节奏、句式长短搭配、对话/叙述比例、标点习惯、段落长度都要落到具体数字。
6. 不要寒暄、不要复述统计原文，直接产出约束。

# 示例格式（仅示范行式，数字请用实际统计值）
平均句长控制在 18 字左右，短句(≤14字)占比不低于 40%，长短句交替制造节奏
对话占比约 35%，叙述占比约 65%，对话用全角引号
逗号每千字约 40 个，谨慎使用破折号与省略号（范本每千字仅 1.2/0.8）
段落平均 80 字，单段不超过 150 字，场景切换另起段
用词避免重复，2-gram 丰富度约 0.62
禁止使用以下 AI 高频套路词：涌起、不禁、仿佛、宛如、一抹、嘴角微微上扬、眼底闪过、缓缓开口、空气仿佛凝固、极其`

  const userPrompt = `指纹名称：${fingerprintName}

# 量化统计特征
${metricsToReadable(metrics)}

# 范本片段（供体感参考，不要逐字模仿）
${snippets || '（无范本片段）'}

# AI 高频套路词总清单（据此判断哪些应禁止）
${clicheWords}

请直接输出文风硬约束摘要（3~6 行，带数字锚点，含禁止套路词清单）。`

  const result = await runAgentModel(
    {
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelName: model.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 文风摘要内置默认 0.3（结构化输出，偏确定性）
      ...resolveSamplingParams(model, 'styleSummary'),
      stream: true,
      mergeSystemMessages: model.mergeSystemMessages,
    },
    { onReasoning },
  )

  // 记录 token 消耗（口径与聊天室 / 剧情预演一致）
  if (result.usage) {
    const usage = normalizeRawUsage(result.usage)
    if (hasUsableUsage(usage)) {
      insertTokenLog({
        modelId,
        action: `提取文风指纹 · ${fingerprintName}`,
        contextType: 'style_fingerprint',
        usage,
        cost: computeUsageCost(usage, model),
        bookId: bookId ?? null,
        bookTitle: bookTitle ?? null,
        systemRequestText: systemPrompt,
        userRequestText: userPrompt,
        responseText: result.content || '',
      })
    }
  }

  return (result.content || '').trim()
}
