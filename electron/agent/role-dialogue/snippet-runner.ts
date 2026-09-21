/**
 * Snippet Runner —— 调度器核心
 *
 * 职责：
 *   1. 读取 Run 上下文（房间、Run、所有已存在的片段）
 *   2. 按 characterIds 顺序**串行**为每个角色生成一条消息：
 *      - 解析 model（3 层兜底）
 *      - 拼装 context（context-builder）
 *      - 流式调用模型（onChunk 推 roleDialogue:snippetDelta）→ 拿到完整 content
 *      - 写入 token_usage_logs
 *      - 累积到 messages[]（后续角色的 context 才会看到前面的发言）
 *   3. 返回 messages[]（渲染进程用其 createSnippet / regenerateSnippet）
 *
 * 边界：
 *   - 任一角色解析失败 → 整段抛错
 *   - 模型调用失败 / 返回为空 / 拒绝生成 → 落"结果提示"片段留存（ERROR_RESULT_PREFIX / REFUSED_RESULT_PREFIX / EMPTY_RESULT_MARKER）
 *   - 串行：后续角色能看到本片段之前角色的 publicContent
 *   - 逐字流式：onChunk 推 IPC → 前端 onSnippetDelta 实时累加
 */

import { eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { jsonrepair } from '../../utils/jsonrepair'
import { v4 as uuidv4 } from 'uuid'
import { getDb, getSqlite } from '../../db'
import { bookSettingEntries, bookMemory, roleDialogueRooms, roleDialogueRuns, roleDialogueSnippets, books } from '../../db/schema'
import { runAgentModel, AgentModelError } from '../model-caller'
import { resolveModelForCharacter } from './model-resolver'
import { resolveSamplingParams } from '../../utils/sampling'
import { buildCharacterContext, isSnippetResultNotice, SNIPPET_EMPTY_RESULT_MARKER, SNIPPET_ERROR_RESULT_PREFIX, SNIPPET_REFUSED_RESULT_PREFIX } from './context-builder'
import type { SnippetMessage, SnippetUsage } from './types'

/**
 * 取空结果 / 失败 / 拒绝 三个标记（来自 context-builder，单一来源）——
 * 让 snippet-runner 与 context-builder 的"结果提示"判定保持一致。
 */
const EMPTY_RESULT_MARKER = SNIPPET_EMPTY_RESULT_MARKER
const ERROR_RESULT_PREFIX = SNIPPET_ERROR_RESULT_PREFIX
const REFUSED_RESULT_PREFIX = SNIPPET_REFUSED_RESULT_PREFIX

/** 与 context-builder 的 isSnippetResultNotice 同步：判定片段是否为"结果提示" */
const isResultNotice = isSnippetResultNotice

// 单条角色发言的 token 消耗统计（与聊天室 ChatRoomMessageUsage 同结构；cost 单位：人民币）
// 类型定义见 ./types 的 SnippetUsage。

function normalizeRawUsage(raw: any) {
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

/** 根据模型原始 usage + 价格，计算单条角色发言的 token 消耗统计（成本拆分口径与聊天室一致） */
function computeSnippetUsage(
  raw: any,
  model: { inputPrice: number; outputPrice: number; cachedInputPrice: number },
): SnippetUsage {
  let { promptTokens, completionTokens, totalTokens, cachedPromptTokens, reasoningTokens } = normalizeRawUsage(raw)

  // 缓存命中数不应超过输入 token 数；若供应商返回异常，钳制到输入大小，避免未命中变负数。
  cachedPromptTokens = Math.min(cachedPromptTokens, promptTokens)

  const missTokens = Math.max(0, promptTokens - cachedPromptTokens)
  const missCost = (missTokens * model.inputPrice) / 1_000_000
  const cacheCost = (cachedPromptTokens * model.cachedInputPrice) / 1_000_000

  // 输出计费 token 数：
  // - 标准 OpenAI 结构：reasoningTokens 是 completionTokens 的子集，按 completionTokens 计费。
  // - 部分推理模型供应商（如 xAI Grok）：completion_tokens 只统计最终输出，reasoning_tokens
  //   单独统计且二者互斥。此时实际 billed 输出 token = completionTokens + reasoningTokens。
  const outputTokensForCost = reasoningTokens > completionTokens
    ? completionTokens + reasoningTokens
    : completionTokens
  const outputCost = (outputTokensForCost * model.outputPrice) / 1_000_000

  const cost = missCost + cacheCost + outputCost
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    reasoningTokens,
    inputPrice: model.inputPrice,
    outputPrice: model.outputPrice,
    cachedPrice: model.cachedInputPrice,
    missCost,
    cacheCost,
    outputCost,
    cost,
  }
}

export type GenerateSnippetArgs = {
  runId: string
  characterIds: string[]
  /** 本片段前作者插入的事实（仅本次调用生效，不入数据库） */
  authorFact?: string | null
  /** 兜底层：前端从 localStorage 'agent:selectedModelId' 读取后传入 */
  agentFallbackModelId?: string | null
}

export async function generateSnippet(args: GenerateSnippetArgs): Promise<SnippetMessage[]> {
  const { runId, characterIds, authorFact, agentFallbackModelId } = args
  if (!characterIds || characterIds.length === 0) {
    throw new Error('characterIds 不能为空')
  }
  const db = getDb()

  // 1. 读 Run → 房间 → 书籍
  const run = db.select().from(roleDialogueRuns).where(eq(roleDialogueRuns.id, runId)).get()
  if (!run) throw new Error(`Run 不存在：${runId}`)
  const room = db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, run.roomId)).get()
  if (!room) throw new Error(`房间不存在：${run.roomId}`)
  const book = db.select().from(books).where(eq(books.id, room.bookId)).get()
  if (!book) throw new Error(`书籍不存在：${room.bookId}`)

  // 2. 读所有已存在的片段（按 order 排序）—— 用于 context-builder
  const existingRows = db.select().from(roleDialogueSnippets)
    .where(eq(roleDialogueSnippets.runId, runId))
    .orderBy(roleDialogueSnippets.order)
    .all()
  const existingSnippets = existingRows.map((r) => ({
    order: r.order,
    kind: ((r as any).kind as 'snippet' | 'summary') || 'snippet',
    summaryContent: (r as any).kind === 'summary'
      ? safeParse<SnippetMessage[]>(r.messages, [])[0]?.publicContent || ''
      : undefined,
    summaryViewName: (r as any).kind === 'summary'
      ? safeParse<SnippetMessage[]>(r.messages, [])[0]?.characterName || ''
      : undefined,
    messages: safeParse<SnippetMessage[]>(r.messages, []),
    authorFactUpdate: r.authorFactUpdate
      ? safeParse<{ fact: string; insertedAt: string } | null>(r.authorFactUpdate, null)
      : null,
  }))

  // 3. 读所有参与角色（一次性，避免循环里反复查）
  // 合并：bookSettingEntries（设定）+ bookMemory（临时人物/只在记忆里）
  const characterRows = db.select().from(bookSettingEntries)
    .where(eq(bookSettingEntries.bookId, room.bookId))
    .all()
  const characterMap = new Map(characterRows.map((c) => [c.id, c]))
  const memRow = db.select({ data: bookMemory.data })
    .from(bookMemory).where(eq(bookMemory.bookId, room.bookId)).get()
  if (memRow?.data) {
    try {
      const v = JSON.parse(memRow.data)
      if (Array.isArray(v?.characters)) {
        for (const c of v.characters) {
          if (c?.id && !characterMap.has(c.id)) {
            characterMap.set(c.id, {
              id: c.id,
              bookId: room.bookId,
              type: 'characters',
              name: c.name || '',
              description: c.description || '',
              detail: c.detail || '',
              createdAt: '',
              updatedAt: '',
            } as any)
          }
        }
      }
    } catch {}
  }

  // 4. 串行生成
  const messages: SnippetMessage[] = []
  for (const cid of characterIds) {
    const character = characterMap.get(cid)
    if (!character) throw new Error(`角色不存在：${cid}`)

    // 4.1 解析 model
    const model = resolveModelForCharacter({
      bookId: room.bookId,
      roomId: room.id,
      characterId: cid,
      agentFallbackModelId: agentFallbackModelId ?? null,
    })

    // 4.2 拼装 context
    const { messages: llmMessages } = buildCharacterContext({
      bookId: room.bookId,
      roomId: room.id,
      runId,
      characterId: cid,
      characterIdsInSnippet: characterIds,
      authorFact: authorFact ?? null,
      // 关键：让本片段"已生成的前序发言"也进入 context
      existingSnippets: [
        ...existingSnippets,
        // 当前片段"已生成但还未存库"的部分
        ...(messages.length > 0
          ? [{
              order: (existingSnippets[existingSnippets.length - 1]?.order ?? 0) + 1,
              kind: 'snippet' as const,
              summaryContent: undefined as string | undefined,
              summaryViewName: undefined as string | undefined,
              messages,
              authorFactUpdate: authorFact ? { fact: authorFact, insertedAt: new Date().toISOString() } : null,
            }]
          : []),
      ],
    })

    // 4.3 调用模型（流式）
    // 注意：模型调用失败 / 返回为空都不再中断整段，而是生成一条"结果提示"片段留存，
    // 保证"即使出错也要留存记录"（与聊天室 chat-runner 行为一致）。
    let content = ''
    let reasoning = ''
    let usage: any = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, reasoningTokens: 0 }
    let modelError: string | null = null
    let modelErrorObj: any = null
    let wasAborted = false
    let result: any
    try {
      result = await runAgentModel({
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelName: model.modelName,
        messages: llmMessages,
        // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 片段扩写内置默认 0.85
        ...resolveSamplingParams(model, 'roleDialogueSnippet'),
        stream: true,
        mergeSystemMessages: model.mergeSystemMessages,
      }, {
        onChunk: (delta) => {
          if (!delta) return
          content += delta
          // 逐字推送 delta 给前端，前端 onSnippetDelta 会实时累加
          try {
            const w = BrowserWindow.getAllWindows?.()[0] ?? null
            w?.webContents.send('roleDialogue:snippetDelta', {
              runId,
              characterId: cid,
              characterName: character.name,
              delta,
              index: messages.length,
              total: characterIds.length,
            })
          } catch (emitErr) {
            // emit 失败不阻塞主流程
            console.error('[role-dialogue] emit snippetDelta failed:', emitErr)
          }
        },
        onReasoning: (delta) => {
          if (!delta) return
          reasoning += delta
          // 流式推送 reasoning delta 给前端，前端实时累加展示模型的"思考过程"
          try {
            const w = BrowserWindow.getAllWindows?.()[0] ?? null
            w?.webContents.send('roleDialogue:snippetReasoning', {
              runId,
              characterId: cid,
              characterName: character.name,
              delta,
              index: messages.length,
              total: characterIds.length,
            })
          } catch (emitErr) {
            // emit 失败不阻塞主流程
            console.error('[role-dialogue] emit snippetReasoning failed:', emitErr)
          }
        },
      })
      if (result && typeof result === 'object' && (result as any).aborted) {
        // 调用方主动 abort（用户重跑 / 取消）：置位标志，不在此 return 出去
        wasAborted = true
      } else if (result && typeof result === 'object') {
        if ((result as any).reasoning) reasoning = (result as any).reasoning
        if ((result as any).usage) usage = (result as any).usage
      }
    } catch (err: any) {
      modelError = err?.message || String(err)
      modelErrorObj = err
      // AgentModelError 携带了流式过程中已累积的 content/reasoning/usage，更新本地变量确保部分结果不丢失
      if (err instanceof AgentModelError && err.partialResult) {
        content = content || err.partialResult.content || ''
        reasoning = reasoning || err.partialResult.reasoning || ''
        usage = err.partialResult.usage || usage
      }
    }

    // 4.4 解析输出（已流式拿到，content 直接是 acc；不再走 JSON 解析 / 内心独白拆分）
    const publicContentRaw = content.trim()

    // 判定"结果提示"：模型调用失败 / 返回为空 / 拒绝生成 —— 与聊天室统一文案
    // 关键原则：已生成的内容（publicContentRaw 非空）必须保留——只把错误信息放到 errorNotice 字段，
    // 让 UI 在气泡下方独立渲染红色错误块，而不是覆盖已经流式推出去的剧情。
    // 只有"完全没产出"时才走原 noticeContent 路径（整气泡都是错误消息）。
    let noticeContent: string | null = null
    let errorNotice: string | null = null
    if (modelError) {
      // 把堆栈的前 5 帧拼到错误信息里——便于排查像 "Unexpected token ':'" 这种
      // 仅有 V8 原生 message、定位不到具体代码位置的错误
      const errAny = modelErrorObj as any
      const stackLines = String(errAny?.stack || '').split('\n').slice(0, 5).join('\n').trim()
      const errMsg = `${ERROR_RESULT_PREFIX}${modelError}${stackLines ? `\n\n${stackLines}` : ''}）`
      if (publicContentRaw) {
        // 部分产出：保留内容，错误信息走 errorNotice
        errorNotice = errMsg
      } else {
        // 完全没产出：整气泡用错误消息
        noticeContent = errMsg
      }
    } else if (!publicContentRaw) {
      noticeContent = EMPTY_RESULT_MARKER
    } else if (looksLikeRefused(publicContentRaw)) {
      // 兜底：model-caller 漏过 finish_reason=content_filter 时，
      // 角色对话自身识别"模型拒绝生成"语义。
      const refusedMsg = `${REFUSED_RESULT_PREFIX}content_filter）`
      // 同样原则：已生成内容就保留、错误独立
      if (publicContentRaw) {
        errorNotice = refusedMsg
      } else {
        noticeContent = refusedMsg
      }
    }

    // 4.5 计算 token 统计（含成本拆分）+ 写 token_usage_logs
    // 判定：是否拿到 provider 返回的 usage 统计（即使 modelError，stream 截断前 provider 仍可能返回 usage：
    //   - content_filter 触发时仍有 promptTokens + 部分 completionTokens
    //   - 网络中断前已收过 usage chunk
    // ）。仅当确实有 usage 数据时计算并写日志——避免对"未真实调用"的纯本地错误也记一笔虚高消费。
    // 改动：从"if (!modelError)"改为按 usage 判定，让出错但有真实消耗的场景也能落 token_log
    // （用户主菜单"消费记录"不丢这笔钱）。
    const normalizedUsage = normalizeRawUsage(usage)
    const hasUsableUsage =
      (normalizedUsage.promptTokens || 0) > 0 ||
      (normalizedUsage.completionTokens || 0) > 0 ||
      (normalizedUsage.totalTokens || 0) > 0
    let usageObj: SnippetUsage | null = null
    if (hasUsableUsage) {
      usageObj = computeSnippetUsage(normalizedUsage, {
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        cachedInputPrice: model.cachedInputPrice,
      })
      writeTokenLog({
        bookId: room.bookId,
        modelId: model.id,
        modelName: model.modelName,
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        cachedPrice: model.cachedInputPrice,
        usage: normalizedUsage,
        bookTitle: book.title,
        // 结果提示（空/失败）也记入文本，便于主菜单 Token 汇总看到发生了什么
        userRequestText: (noticeContent ?? publicContentRaw).slice(0, 500),
        systemRequestText: llmMessages.find((m) => m.role === 'system')?.content.slice(0, 500) || '',
        // 关键：把当前角色名传给 writeTokenLog，action 会变成"剧情预演 · 角色名"
        characterName: character.name,
      })
    }

    // 4.6 累积到 messages（供后续角色看到）—— 无论正常 / 空 / 失败都落一条，保证留存记录；
    // 并附带该角色的 token 统计（usage）与发给模型的上下文（modelMessages，用于"查看上下文"）。
    const snippetMessage: SnippetMessage = {
      characterId: cid,
      characterName: character.name,
      publicContent: noticeContent ?? publicContentRaw,
      innerThought: '',
      // 仅在"部分产出 + 错误"时填：让 UI 在气泡下方独立渲染红色错误块
      errorNotice: errorNotice ?? undefined,
      // 推理模型的"思考过程"完整文本：让用户能查看模型推理过程。流式实时显示由 onReasoning emit 完成。
      reasoning: (reasoning || '').trim() || undefined,
      modelId: model.id,
      usage: usageObj,
      modelMessages: JSON.stringify(llmMessages),
    }
    messages.push(snippetMessage)

    // 4.7 增量 emit：让渲染进程能"逐角色"实时显示
    try {
      const w = BrowserWindow.getAllWindows?.()[0] ?? null
      w?.webContents.send('roleDialogue:snippetChunk', {
        runId,
        index: messages.length - 1,
        total: characterIds.length,
        message: snippetMessage,
      })
    } catch (emitErr) {
      // emit 失败不阻塞主流程
      console.error('[role-dialogue] emit snippetChunk failed:', emitErr)
    }
  }

  // 5. 全部完成 → emit done（保留旧的 return messages，向后兼容）
  try {
    const w = BrowserWindow.getAllWindows?.()[0] ?? null
    w?.webContents.send('roleDialogue:snippetDone', { runId, messages })
  } catch (emitErr) {
    console.error('[role-dialogue] emit snippetDone failed:', emitErr)
  }

  return messages
}

// ─── 工具函数 ─────────────────────────────────────────────

/** 解析模型返回的 JSON 输出（宽松解析：兼容 markdown 代码块、jsonrepair） */
function parseModelJsonOutput(content: string): { publicContent?: string; innerThought?: string; _raw?: string } {
  let text = content.trim()
  // 去除 markdown 代码块
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
  }
  // 尝试直接 parse
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object') return obj
  } catch {}
  // 尝试 jsonrepair
  try {
    const obj = JSON.parse(jsonrepair(text))
    if (obj && typeof obj === 'object') return obj
  } catch {}
  // 尝试从首段抓 {...}
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const sub = text.slice(first, last + 1)
    try {
      const obj = JSON.parse(jsonrepair(sub))
      if (obj && typeof obj === 'object') return obj
    } catch {}
  }
  // 三次都救不回：返回特殊标记，调用方会把它落成"模型输出无法解析"错误片段
  // 而不是把残缺 JSON 当作台词展示（避免污染后续角色上下文）
  return { publicContent: '__JSON_PARSE_FAILED__', _raw: text.slice(0, 500) }
}

/** 兜底识别"模型拒绝生成"语义：常见于 finish_reason=content_filter 漏过的场景 */
function looksLikeRefused(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  if (t.length > 200) return false // 只在短文本里识别，避免误判
  return /^(I'?m sorry|i apologize|对不起|抱歉|无法|不能|拒绝|不可以|I cannot|as an AI|I can'?t)/i.test(t)
}

function writeTokenLog(args: {
  bookId: string
  modelId: string
  modelName: string
  inputPrice: number
  outputPrice: number
  cachedPrice: number
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedPromptTokens?: number; reasoningTokens?: number }
  bookTitle: string
  userRequestText: string
  systemRequestText: string
  characterName: string
}) {
  try {
    const { usage, inputPrice, outputPrice, cachedPrice } = args
    const cachedTokens = usage.cachedPromptTokens || 0
    const missTokens = (usage.promptTokens || 0) - cachedTokens
    const missCost = missTokens * inputPrice / 1_000_000
    const cacheCost = cachedTokens * cachedPrice / 1_000_000
    const outputCost = (usage.completionTokens || 0) * outputPrice / 1_000_000
    const totalCost = missCost + cacheCost + outputCost
    getSqlite().prepare(
      `INSERT INTO token_usage_logs (
        id, book_id, chapter_id, volume_id, model_id, action, context_type,
        prompt_tokens, completion_tokens, total_tokens,
        cached_prompt_tokens, reasoning_tokens, cost, calls,
        book_title, request_text, system_request_text, user_request_text, response_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'role_dialogue', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '', ?)`,
    ).run(
      uuidv4(),
      args.bookId,
      null, null,
      args.modelId,
      // 用户可读 action：剧情预演 + 角色名（与 summary-runner 保持一致：action 字段带角色名后缀）
      // 例如 "剧情预演 · 李晓雯"
      `剧情预演 · ${args.characterName}`,
      usage.promptTokens || 0,
      usage.completionTokens || 0,
      usage.totalTokens || 0,
      cachedTokens,
      usage.reasoningTokens || 0,
      totalCost,
      args.bookTitle,
      // request_text 存完整 system+user 拼起来的简要摘要；详细文本由前端展示
      `${args.systemRequestText.slice(0, 200)}\n...\n${args.userRequestText.slice(0, 200)}`,
      args.systemRequestText.slice(0, 2000),
      args.userRequestText.slice(0, 2000),
      new Date().toISOString(),
    )
  } catch (err) {
    // token log 写失败不阻塞主流程
    console.error('[role-dialogue] writeTokenLog failed:', err)
  }
}

function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try { return JSON.parse(text) as T } catch { return fallback }
}
