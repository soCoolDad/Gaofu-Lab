/**
 * Summary Runner —— 「总结片段」生成器
 *
 * 职责：把指定范围内的多个片段（snippet）压缩成一段完整的剧情片段（summary），
 *       作为后续生成的"上下文起点"，之前的片段不再注入到模型 prompt。
 *
 * 视角选择：
 *   - first-person：以某个具体角色"我"的口吻总结（用户从在场角色中选一个）
 *   - third-person：第三方旁白群像视角，无角色代入
 *
 * 总结范围：
 *   - 增量：找到最近一条 summary 消息，从它之后到当前的所有 snippet 参与总结
 *   - 首次：所有 snippet 都参与总结
 *   - 范围内的其他 summary 不参与（避免递归总结）
 *
 * 输出：
 *   - 一条 kind='summary' 的 snippet，存到 messages[0].publicContent
 *   - 覆盖范围存到 summaryCoveredSnippetIds
 *
 * 流式事件：roleDialogue:summaryDelta / roleDialogue:summaryDone
 */

import { eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../../db'
import {
  roleDialogueRooms,
  roleDialogueRuns,
  roleDialogueSnippets,
  books,
  modelProviders,
  tokenUsageLogs,
} from '../../db/schema'
import { runAgentModel, AgentModelError } from '../model-caller'
import { resolveModelForCharacter } from './model-resolver'
import { SNIPPET_ERROR_RESULT_PREFIX, SNIPPET_EMPTY_RESULT_MARKER } from './context-builder'
import type { SnippetMessage, SnippetUsage } from './types'

export type GenerateSummaryArgs = {
  runId: string
  /** 'first-person' 选择某个角色；'third-person' 第三方旁白群像 */
  view: 'first-person' | 'third-person'
  /** first-person 模式下必填：被选中的角色 id（bookSettingEntries.id） */
  viewCharacterId?: string | null
  /** 兜底层：前端从 localStorage 'agent:selectedModelId' 读取后传入 */
  agentFallbackModelId?: string | null
  /** 重新总结模式：指定要重新生成的 summary 片段 id，后端将复用其 coveredSnippetIds，并原地更新该 summary */
  sourceSummaryId?: string | null
}

export type SummaryProgressEvent =
  | { type: 'delta'; runId: string; summaryId: string; delta: string }
  | { type: 'reasoningDelta'; runId: string; summaryId: string; delta: string }
  | { type: 'done'; runId: string; summaryId: string; snippet: any }
  | { type: 'error'; runId: string; message: string }

function emit(event: SummaryProgressEvent) {
  try {
    const w = BrowserWindow.getAllWindows?.()[0] ?? null
    const channel = (() => {
      switch (event.type) {
        case 'delta': return 'roleDialogue:summaryDelta'
        case 'reasoningDelta': return 'roleDialogue:summaryReasoning'
        case 'done': return 'roleDialogue:summaryDone'
        case 'error': return 'roleDialogue:summaryError'
      }
    })()
    w?.webContents.send(channel, event)
  } catch (err) {
    console.error('[role-dialogue] emit summary event failed:', err)
  }
}

function now() {
  return new Date().toISOString()
}

function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  if (typeof text === 'object') return text as any
  try { return JSON.parse(text) as T } catch { return fallback }
}

/** 归一化 provider 返回的 usage（不同 provider 字段名不一样），口径与 snippet-runner 的 normalizeRawUsage 一致 */
function normalizeUsage(raw: any) {
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

export async function generateSummary(args: GenerateSummaryArgs): Promise<any> {
  const { runId, view, viewCharacterId, agentFallbackModelId } = args
  if (view === 'first-person' && !viewCharacterId) {
    throw new Error('第一人称视角必须选择角色')
  }
  const db = getDb()

  // 1. 读 Run → 房间 → 书籍
  const run = db.select().from(roleDialogueRuns).where(eq(roleDialogueRuns.id, runId)).get()
  if (!run) throw new Error(`Run 不存在：${runId}`)
  const room = db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, run.roomId)).get()
  if (!room) throw new Error(`房间不存在：${run.roomId}`)
  const book = db.select().from(books).where(eq(books.id, room.bookId)).get()
  if (!book) throw new Error('书籍不存在')

  // 2. 读所有片段（按 order 排序）
  const allRows = db.select().from(roleDialogueSnippets)
    .where(eq(roleDialogueSnippets.runId, runId))
    .orderBy(roleDialogueSnippets.order)
    .all()
  const allSnippets = allRows.map((r) => ({
    id: r.id,
    order: r.order,
    kind: (r.kind as 'snippet' | 'summary') || 'snippet',
    characterIds: safeParse<string[]>(r.characterIds, []),
    messages: safeParse<SnippetMessage[]>(r.messages, []),
    versions: r.versions,
    regenerateCount: (r.regenerateCount ?? 0),
    summaryView: r.summaryView,
    summaryViewCharacterId: r.summaryViewCharacterId,
    summaryCoveredSnippetIds: safeParse<string[]>(r.summaryCoveredSnippetIds, []),
  }))

  // 3. 计算总结范围：
  //    - 新建总结（sourceSummaryId 为空）：增量——找最近一条 summary，从它**之后**到当前的所有 snippet
  //    - 重新总结（sourceSummaryId 有值）：复用原 summary 的 summaryCoveredSnippetIds，不再要求"最近 summary 之后还有新片段"
  //    范围里的 summary 本身不参与总结（避免递归）。
  const sourceSummary = args.sourceSummaryId
    ? allSnippets.find((s) => s.id === args.sourceSummaryId && s.kind === 'summary') ?? null
    : null
  if (args.sourceSummaryId && !sourceSummary) {
    throw new Error('要重新总结的片段不存在或不是总结片段')
  }

  let sourceSnippets: typeof allSnippets
  if (sourceSummary) {
    sourceSnippets = allSnippets.filter(
      (s) => s.kind === 'snippet' && sourceSummary.summaryCoveredSnippetIds.includes(s.id),
    )
    if (sourceSnippets.length === 0) {
      throw new Error('原总结没有覆盖任何可总结的片段')
    }
  } else {
    let lastSummaryIdx = -1
    for (let i = allSnippets.length - 1; i >= 0; i--) {
      if (allSnippets[i].kind === 'summary') {
        lastSummaryIdx = i
        break
      }
    }
    const rangeStart = lastSummaryIdx + 1
    sourceSnippets = allSnippets.slice(rangeStart).filter((s) => s.kind === 'snippet')
    if (sourceSnippets.length === 0) {
      throw new Error('没有可总结的片段（上次总结之后还没有新片段）')
    }
  }
  const coveredSnippetIds = sourceSnippets.map((s) => s.id)

  // summaryId / order 决策：
  //   - 新建：新 uuid，放在最后（lastOrder + 1）
  //   - 重新总结：复用原 summary 的 id 与 order，原地更新，避免生成重复的 summary 卡片
  const lastOrder = allSnippets.length > 0 ? Math.max(...allSnippets.map((s) => s.order)) : 0
  const summaryId = sourceSummary ? sourceSummary.id : uuidv4()
  const newOrder = sourceSummary ? sourceSummary.order : lastOrder + 1

  // 4. 解析 model
  //    优先级：角色级偏好 > 房间默认 > 兜底（与 snippet-runner 共用 model-resolver，自动解密 apiKey）
  //    关键：必须用 resolveModelForCharacter，里面会调用 decodeModelApiKey 把加密的 apiKey 解密——
  //    之前手写 resolveModel 直接读 row.apiKey 拿到的是密文，导致第三方 provider 报 "Invalid token"。
  const modelRow = (() => {
    if (view === 'first-person' && viewCharacterId) {
      try {
        return resolveModelForCharacter({
          bookId: room.bookId,
          roomId: room.id,
          characterId: viewCharacterId,
          agentFallbackModelId: agentFallbackModelId ?? null,
        })
      } catch {
        // 第一人称角色没配 model 时回落到房间默认 / 兜底
      }
    }
    // 第三人称或角色无偏好：从被覆盖的 snippets 里挑一个参与角色（优先第一个），复用其 model 偏好
    const fallbackCharacterId = sourceSnippets[0]?.messages?.[0]?.characterId
    return resolveModelForCharacter({
      bookId: room.bookId,
      roomId: room.id,
      characterId: fallbackCharacterId || '__narrator__',
      agentFallbackModelId: agentFallbackModelId ?? null,
    })
  })()
  // model-resolver 返回的是 baseUrl/apiKey/modelName 扁平结构，需要平展成 runAgentModel 期望的"row"形状
  // 用 model-resolver 已经返回的 inputPrice/outputPrice/cachedInputPrice 字段
  const providerRow = db.select().from(modelProviders).where(eq(modelProviders.id, modelRow.id)).get()
  const model = {
    id: modelRow.id,
    baseUrl: modelRow.baseUrl,
    apiKey: modelRow.apiKey,
    modelName: modelRow.modelName,
    inputPrice: modelRow.inputPrice,
    outputPrice: modelRow.outputPrice,
    cachedInputPrice: modelRow.cachedInputPrice,
    enabled: providerRow?.enabled ?? true,
  }

  // 5. 构造 prompt
  const viewName = (() => {
    if (view === 'third-person') return '旁白视角'
    if (!viewCharacterId) return '旁白视角'
    const ch = sourceSnippets.flatMap((s) => s.messages).find((m) => m.characterId === viewCharacterId)
    return ch?.characterName || '主角'
  })()

  const sourceText = sourceSnippets.map((s) => {
    const lines = s.messages
      .filter((m) => m.publicContent && m.publicContent.trim())
      .map((m) => `  ${m.characterName}：${m.publicContent}`)
      .join('\n')
    return `【片段 #${s.order}】\n${lines}`
  }).join('\n\n')

  // 累计要参考的"前序"信息：当前 summary 之前的所有 summary，作为锚点
  // 重新总结时，被替换的原 summary 自身不应作为前序（它马上要被新内容覆盖）
  const priorSummaries = allSnippets.filter((s) => s.kind === 'summary' && s.order < newOrder)
  const priorSummaryText = priorSummaries.length === 0
    ? ''
    : '\n\n【前序总结（作为锚点背景）】\n' + priorSummaries.map((s) => {
        const content = s.messages[0]?.publicContent || ''
        return `（${s.messages[0]?.characterName || '旁白视角'} 总结于片段 #${s.order}）\n${content}`
      }).join('\n\n')

  const systemPrompt = `你是一位专业的小说作者 / 编剧，擅长把零散的多轮对话扩写并融合为一段连贯、生动的剧情。

# 视角
${view === 'first-person'
  ? `以「${viewName}」的**第一人称「我」**视角描写。用「我」来叙述整个场景，看到其他角色的言行（用「他/她/名字」称呼），写得像「${viewName}」事后回忆这段经历的内心独白。`
  : `以**第三方旁白群像视角**描写。客观、生动地叙述场景中发生的事：每个角色的行动、对话、表情、心理都予以呈现，但叙述者不代入任何单一角色（用「他/她/名字」指代角色）。`}

# 当前情境
${room.situation || '（作者未指定情境）'}

# 任务
根据下方"待融合的对话片段"，**生成一段完整的剧情**：
- **不要**只是压缩或复述原话——而是补全场景、动作、心理、环境描写，**把零散的对话连缀成一段有起承转合的剧情**
- 保留并强化：关键情节推进、角色性格特征、角色间关系变化、情感张力
- 风格要像在写小说 / 影视剧本的场景描写（第三人称旁白或第一人称内心独白）
- 篇幅适中：与待融合内容长度匹配，让剧情充实但不冗长
- **不要**输出 JSON / Markdown 代码块 / 字段名等结构化标记
- **不要**写"以下是剧情"之类的元说明，直接进入剧情正文
- **不要**用"角色A说：xxx"这种剧本式标记——要把对话自然融入叙述中
${priorSummaryText ? `
# 之前的剧情（衔接点）
${priorSummaryText}
请自然承接上文，避免重复已经写过的内容。` : ''}

# 纠错要求（在生成剧情时同步完成）
请在扩写时主动检查并纠正以下错误，不要把原始对话里的错误原样搬到剧情里：
- **常识逻辑错误**：违反物理 / 时间 / 空间 / 因果关系的描写（例如同时在不同地点、死后行动、空间穿越等），统一改成合理版本
- **语法 / 错别字错误**：对话中可能存在的语法错乱、错别字、漏字、重复字，统一修正为规范中文
- **人称错误**：把对话里搞混的第一人称 / 第二人称 / 第三人称（尤其是对话原文是"我"但剧情该用角色名、或者代词"他/她"指代对象混乱），按你被指定的视角**统一修正**——第一人称视角下"我"指代 ${view === 'first-person' ? `「${viewName}」` : '当前视角角色'}，其他角色用名字或"他/她"；第三人称视角下用"他/她/名字"指代所有角色
- **描述错误**：对话里自我矛盾的事实（例如同一段里先说"天黑了"后说"阳光刺眼"），按合理版本统一
  - 不要在正文里标注"已修正xxx"——直接输出修正后的剧情，让读者看不出原对话曾有错误`

  const userPrompt = `以下是待融合的对话片段（按时间顺序）：

${sourceText}

---

请按你被指定的视角，**直接生成**完整的剧情正文。`

  // 6. 调用模型（流式）
  let content = ''
  let reasoning = ''
  let usage: any = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, reasoningTokens: 0 }
  let modelError: string | null = null
  const llmMessages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  try {
    // 关键：用 await 接住 resolve 返回值——runAgentModel 在 done 时把 usage 放进 result
    // 之前没接 result，导致 usage 永远是初始空对象，token_log 永远写不进数据库
    // （与 snippet-runner 的写法保持一致：line 220 `const result = await runAgentModel(...)`）
    const result = await runAgentModel({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelName: model.modelName,
      messages: llmMessages,
      temperature: 0.7,
      stream: true,
    }, {
      onChunk: (delta) => {
        if (!delta) return
        content += delta
        emit({ type: 'delta', runId, summaryId, delta })
      },
      onReasoning: (delta) => {
        if (!delta) return
        reasoning += delta
        emit({ type: 'reasoningDelta', runId, summaryId, delta })
      },
    })
    if (result && result.usage) {
      usage = result.usage
    }
  } catch (err: any) {
    modelError = err?.message || String(err)
    if (err instanceof AgentModelError && err.partialResult) {
      content = content || err.partialResult.content || ''
      reasoning = reasoning || err.partialResult.reasoning || ''
      usage = err.partialResult.usage || usage
    }
  }

  const finalContent = content.trim()
  // 7a. 计算 token 消耗 + 成本（与 snippet-runner 的 computeSnippetUsage 同口径）
  // 关键：让前端"查看上下文"按钮、token 徽标都能正常显示（之前 message.usage = null 导致没统计）
  const norm = normalizeUsage(usage)
  const cachedPromptTokens = Math.min(norm.cachedPromptTokens, norm.promptTokens)
  const missTokens = Math.max(0, norm.promptTokens - cachedPromptTokens)
  const missCost = (missTokens * (model.inputPrice || 0)) / 1_000_000
  const cacheCost = (cachedPromptTokens * (model.cachedInputPrice || model.inputPrice || 0)) / 1_000_000
  // 输出计费 token：reasoningTokens > completionTokens 时（如 xAI Grok）按互斥计
  const outputTokensForCost = norm.reasoningTokens > norm.completionTokens
    ? norm.completionTokens + norm.reasoningTokens
    : norm.completionTokens
  const outputCost = (outputTokensForCost * (model.outputPrice || 0)) / 1_000_000
  const hasUsableUsage = (norm.promptTokens || 0) > 0
    || (norm.completionTokens || 0) > 0
    || (norm.totalTokens || 0) > 0
  const messageUsage: SnippetUsage | null = hasUsableUsage ? {
    promptTokens: norm.promptTokens,
    completionTokens: norm.completionTokens,
    totalTokens: norm.totalTokens,
    cachedPromptTokens,
    reasoningTokens: norm.reasoningTokens,
    inputPrice: model.inputPrice || 0,
    outputPrice: model.outputPrice || 0,
    cachedPrice: model.cachedInputPrice || model.inputPrice || 0,
    missCost,
    cacheCost,
    outputCost,
    cost: missCost + cacheCost + outputCost,
  } : null
  // 错误占位策略（与 snippet-runner 略有不同）：
  //   - 已有部分内容（finalContent 非空）：保留内容，错误走 errorNotice
  //   - 完全没产出：publicContent 留空，错误**全部**走 errorNotice
  //     关键改进：不再把错误消息塞进 publicContent 充当"主体内容"，让 summary 卡片
  //     保持紫色渐变 + 空内容占位的视觉一致性，错误信息统一在卡片外部底部独立显示。
  //     （之前的方式让"完全没产出"的卡片变成"整张红字"在卡片里面，UI 体验不好。）
  let errorNotice: string | null = null
  let emptyPlaceholder: string | null = null
  if (modelError) {
    errorNotice = `${SNIPPET_ERROR_RESULT_PREFIX}${modelError}）`
  } else if (!finalContent) {
    emptyPlaceholder = SNIPPET_EMPTY_RESULT_MARKER
  }
  // 公共内容：优先 finalContent；否则显示"生成失败，请重新总结"占位（仅在出错/空时）
  const publicContent = finalContent
    || emptyPlaceholder
    || '生成失败，请点击卡片重新总结'

  // 7b. 落库（kind='summary'）—— 无论如何都落一条，让 UI 拿到占位卡片显示错误
  const ts = now()
  // 视角名存到 messages[0].characterName；summary 的 consolidatedContent 存到 publicContent
  // 参与角色（用于 UI 提示）从被覆盖的 snippets 中去重提取
  const participantSet = new Set<string>()
  for (const s of sourceSnippets) {
    for (const cid of s.characterIds) participantSet.add(cid)
  }
  const summaryMessage: SnippetMessage = {
    characterId: view === 'first-person' ? (viewCharacterId || '__narrator__') : '__narrator__',
    characterName: viewName,
    publicContent,
    innerThought: '',
    errorNotice: errorNotice ?? undefined,
    reasoning: (reasoning || '').trim() || undefined,
    modelId: model.id,
    usage: messageUsage,
    modelMessages: JSON.stringify(llmMessages),
  }

  if (sourceSummary) {
    // 重新总结：原地更新原 summary 行，保留历史版本并递增 regenerateCount（与普通片段的 regenerateSnippet 行为对齐）
    const oldMessages = sourceSummary.messages
    const oldVersions = safeParse<any[]>(sourceSummary.versions, [])
    const newVersions = [
      ...oldVersions,
      { messages: oldMessages, regeneratedAt: ts },
    ]
    db.update(roleDialogueSnippets)
      .set({
        messages: JSON.stringify([summaryMessage]),
        versions: JSON.stringify(newVersions),
        regenerateCount: (sourceSummary.regenerateCount ?? 0) + 1,
        summaryView: view,
        summaryViewCharacterId: view === 'first-person' ? (viewCharacterId || null) : null,
        summaryCoveredSnippetIds: JSON.stringify(coveredSnippetIds),
        updatedAt: ts,
      })
      .where(eq(roleDialogueSnippets.id, summaryId))
      .run()
  } else {
    // 新建总结：插入到末尾
    db.insert(roleDialogueSnippets).values({
      id: summaryId,
      runId,
      order: newOrder,
      characterIds: JSON.stringify(Array.from(participantSet)),
      messages: JSON.stringify([summaryMessage]),
      versions: '[]',
      regenerateCount: 0,
      authorFactUpdate: null,
      kind: 'summary',
      summaryView: view,
      summaryViewCharacterId: view === 'first-person' ? (viewCharacterId || null) : null,
      summaryCoveredSnippetIds: JSON.stringify(coveredSnippetIds),
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  // 写 token log
  try {
    const norm = {
      promptTokens: usage?.prompt_tokens ?? usage?.promptTokens ?? 0,
      completionTokens: usage?.completion_tokens ?? usage?.completionTokens ?? 0,
      totalTokens: usage?.total_tokens ?? usage?.totalTokens ?? 0,
      cachedPromptTokens: usage?.prompt_tokens_details?.cached_tokens
        ?? usage?.cached_prompt_tokens ?? usage?.cachedPromptTokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens
        ?? usage?.reasoning_tokens ?? usage?.reasoningTokens ?? 0,
    }
    const totalCost = (
      Math.max(0, norm.promptTokens - norm.cachedPromptTokens) * (model.inputPrice || 0) +
      norm.cachedPromptTokens * (model.cachedInputPrice || model.inputPrice || 0) +
      norm.completionTokens * (model.outputPrice || 0)
    ) / 1_000_000
    if (norm.promptTokens || norm.completionTokens || norm.totalTokens) {
      getDb().insert(tokenUsageLogs).values({
        id: uuidv4(),
        bookId: room.bookId,
        chapterId: null,
        volumeId: null,
        modelId: model.id,
        // 关键：把视角/角色名拼到 action 字段里，方便在「数据管理 → 消费记录」中区分多个 summary
        // 第三人称 → "剧情预演总结 · 旁白视角"
        // 第一人称 → "剧情预演总结 · 角色名"
        action: `剧情预演总结 · ${viewName}`,
        contextType: 'role_dialogue_summary',
        promptTokens: norm.promptTokens,
        completionTokens: norm.completionTokens,
        totalTokens: norm.totalTokens,
        cachedPromptTokens: norm.cachedPromptTokens,
        reasoningTokens: norm.reasoningTokens,
        cost: totalCost,
        calls: 1,
        bookTitle: book.title,
        requestText: sourceText.slice(0, 1000),
        systemRequestText: systemPrompt.slice(0, 1000),
        userRequestText: userPrompt.slice(0, 1000),
        responseText: publicContent.slice(0, 2000),
        createdAt: ts,
      }).run()
    }
  } catch (e) {
    console.error('[role-dialogue] summary token log failed:', e)
  }

  // 8. 读回整条 snippet 返回
  const stored = db.select().from(roleDialogueSnippets)
    .where(eq(roleDialogueSnippets.id, summaryId)).get()
  const parsed = {
    ...stored,
    // 关键：parsed 必须带 kind 字段——前端用 s.kind === 'summary' 区分渲染 SummaryBubble，
    // 之前漏了，store push 后这个 snippet 永远走不到 SummaryBubble 路径，导致"summary 卡片消失"。
    kind: ((stored as any).kind as 'snippet' | 'summary') || 'summary',
    characterIds: safeParse<any[]>((stored as any).characterIds, []),
    messages: safeParse<any[]>((stored as any).messages, []),
    versions: safeParse<any[]>((stored as any).versions, []),
    authorFactUpdate: (stored as any).authorFactUpdate
      ? safeParse<any>((stored as any).authorFactUpdate, null)
      : null,
    summaryView: (stored as any).summaryView ?? null,
    summaryViewCharacterId: (stored as any).summaryViewCharacterId ?? null,
    summaryCoveredSnippetIds: safeParse<string[]>((stored as any).summaryCoveredSnippetIds, []),
  }

  emit({ type: 'done', runId, summaryId, snippet: parsed })
  return parsed
}
