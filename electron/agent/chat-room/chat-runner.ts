/**
 * 聊天室生成编排（Chat Runner）
 *
 * 一次"回合"（turn）的流程：
 *   1. 若用户有输入，先把用户（导演）消息落库。
 *   2. 按在场角色（chat_room_participants.sortOrder）让角色接龙：
 *      - speakingMode = 'sequential'：串行，每个角色依次接龙一句（能看到前序角色的发言）。
 *      - speakingMode = 'simultaneous'：并行，所有角色基于同一历史各回一句（彼此看不到对方的本轮发言）。
 *      - 解析 model（3 层兜底）→ 拼装上下文（完整聊天历史 + 角色人设）→ 调 runAgentModel(stream:true)
 *        逐字流式推给前端 → 落库最终内容（同时把发给模型的 messages 数组存进 model_messages）。
 *   3. 全部完成 → emit turnDone（前端据此重新拉取权威消息列表）。
 *
 * 另提供 characterSpeak(roomId, characterId)：让单个在场角色基于当前历史单独说一句。
 *
 * 边界：
 *   - 模型输出是纯文本台词（非 JSON），逐字直接拼到气泡，无需流式 JSON 解析。
 *   - 任一阵营模型调用失败 / 返回空 → 不再删除占位，而是把错误/空提示写进该角色的消息卡片（仍存 modelMessages 供查看上下文），
 *     并继续整轮（sequential 不中断、simultaneous 用 allSettled 其余不受影响）；这类提示卡片不进入后续角色的历史上下文。
 *   - 并发保护：同一房间同一时刻只允许一个回合在跑。
 */

import { and, eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb, getSqlite } from '../../db'
import {
  books,
  bookMemory,
  bookSettingEntries,
  chatRoomMessages,
  chatRoomParticipants,
  chatRoomRooms,
} from '../../db/schema'
import { runAgentModel, AgentModelError } from '../model-caller'
import { resolveChatRoomModel } from './model-resolver'
import { resolveSamplingParams } from '../../utils/sampling'
import { buildChatContext, cleanCharacterLine, isChatResultNotice, CHAT_EMPTY_RESULT_MARKER, CHAT_ERROR_RESULT_PREFIX, CHAT_REFUSED_RESULT_PREFIX, type ChatHistoryItem, type CharacterStateBrief } from './context-builder'
import { getAllCharacterMemoryStates, getCharacterRelationships } from './memory-states'
import type { ChatRoomMessage, ChatRoomMessageUsage, ChatRoomRole, ChatRoomSpeakingMode, SendTurnInput } from './types'

/** 正在生成的房间集合（并发保护） */
const generatingRooms = new Set<string>()

function now() {
  return new Date().toISOString()
}

/**
 * 取空结果 / 失败 / 拒绝 三个标记（来自 context-builder，单一来源）
 * —— 让 chat-runner 与 context-builder 的"结果提示"判定保持一致，
 * 任何新加的"结果提示"文案只要在 context-builder 加分支即可自动同步。
 */
const EMPTY_RESULT_MARKER = CHAT_EMPTY_RESULT_MARKER
const ERROR_RESULT_PREFIX = CHAT_ERROR_RESULT_PREFIX
const REFUSED_RESULT_PREFIX = CHAT_REFUSED_RESULT_PREFIX

/**
 * 判定卡片内容是否为"结果提示"（空 / 失败 / 拒绝）—— 统一用 context-builder 导出的判定。
 * 这类卡片只展示给用户、不进入后续角色的历史上下文。
 * （保留本地别名 isResultNotice 让 sendTurn 里的过滤代码风格一致）
 */
const isResultNotice = isChatResultNotice

/** 取当前激活窗口（用于发流式事件） */
function activeWindow(): BrowserWindow | null {
  try {
    return BrowserWindow.getAllWindows?.()[0] ?? null
  } catch {
    return null
  }
}

function emit(event: string, payload: any) {
  try {
    activeWindow()?.webContents.send(event, payload)
  } catch (err) {
    console.error(`[chat-room] emit ${event} failed:`, err)
  }
}

/** 读取某角色的人设文本（bookSettingEntries 优先，缺失时回退 bookMemory） */
function getCharacterSetting(bookId: string, characterId: string, fallbackName: string): { name: string; setting: string } {
  const db = getDb()
  const row = db.select().from(bookSettingEntries)
    .where(eq(bookSettingEntries.id, characterId)).get()
  if (row) {
    const setting = [row.description || '', row.detail || ''].filter(Boolean).join('\n')
    return { name: row.name || fallbackName, setting }
  }
  // 回退：bookMemory.characters
  const memRow = db.select({ data: bookMemory.data }).from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()
  if (memRow?.data) {
    try {
      const parsed = JSON.parse(memRow.data)
      const chars: any[] = Array.isArray(parsed?.characters) ? parsed.characters : []
      const hit = chars.find((c) => String(c?.id) === characterId)
      if (hit) {
        const setting = [hit.description || '', hit.detail || ''].filter(Boolean).join('\n')
        return { name: hit.name || fallbackName, setting }
      }
    } catch {}
  }
  return { name: fallbackName, setting: '' }
}

/** 计算房间内下一个 order */
function nextOrder(db: ReturnType<typeof getDb>, roomId: string): number {
  const rows = db.select({ order: chatRoomMessages.order })
    .from(chatRoomMessages)
    .where(eq(chatRoomMessages.roomId, roomId))
    .all()
  let max = 0
  for (const r of rows) max = Math.max(max, r.order)
  return max + 1
}

function serializeMessage(row: any): ChatRoomMessage {
  let usage: ChatRoomMessageUsage | null = null
  if (row.usage) {
    try {
      usage = JSON.parse(row.usage)
    } catch {}
  }
  return {
    id: row.id,
    roomId: row.roomId,
    order: row.order,
    role: row.role,
    characterId: row.characterId ?? null,
    characterName: row.characterName ?? null,
    content: row.content || '',
    // 错误信息（与 role-dialogue 的 errorNotice 列对齐）：content_filter / 中断时单独存
    errorNotice: row.errorNotice ?? null,
    // 推理模型的"思考过程"完整文本：仅当模型支持 reasoning 时才有内容
    reasoning: row.reasoning ?? null,
    modelId: row.modelId ?? null,
    modelMessages: row.modelMessages ?? null,
    usage,
    createdAt: row.createdAt,
  }
}

/**
 * 把模型原始 usage 归一化为 ChatRoomMessageUsage 字段名。
 * 模型返回的是 OpenAI 原始结构：prompt_tokens / completion_tokens / total_tokens，
 * 且缓存命中 token 嵌套在 prompt_tokens_details.cached_tokens、思考 token 嵌套在
 * completion_tokens_details.reasoning_tokens。部分供应商（或自家结构）可能直接给 camelCase，
 * 这里两种都兼容。
 */
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

/** 根据模型原始 usage + model 价格，计算单条消息的 token 消耗统计（cost 单位：人民币） */
function computeChatUsage(raw: any, model: { inputPrice: number; outputPrice: number; cachedInputPrice: number }): ChatRoomMessageUsage {
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

function writeTokenLog(args: {
  bookId: string
  modelId: string
  modelName: string
  usageObj: ChatRoomMessageUsage
  bookTitle: string
  characterName: string
  systemRequestText: string
  userRequestText: string
}) {
  try {
    const { usageObj } = args
    getSqlite().prepare(
      `INSERT INTO token_usage_logs (
        id, book_id, chapter_id, volume_id, model_id, action, context_type,
        prompt_tokens, completion_tokens, total_tokens,
        cached_prompt_tokens, reasoning_tokens, cost, calls,
        book_title, request_text, system_request_text, user_request_text, response_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'chat_room', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '', ?)`,
    ).run(
      uuidv4(),
      args.bookId,
      null, null,
      args.modelId,
      `角色聊天 · ${args.characterName}`,
      usageObj.promptTokens,
      usageObj.completionTokens,
      usageObj.totalTokens,
      usageObj.cachedPromptTokens,
      usageObj.reasoningTokens,
      usageObj.cost,
      args.bookTitle,
      `${args.systemRequestText.slice(0, 200)}\n...\n${args.userRequestText.slice(0, 200)}`,
      args.systemRequestText.slice(0, 2000),
      args.userRequestText.slice(0, 2000),
      new Date().toISOString(),
    )
  } catch (err) {
    console.error('[chat-room] writeTokenLog failed:', err)
  }
}

/** 构建一段历史转录（角色消息带说话人标签）。
 * 关键：过滤掉"结果提示"卡片（空 / 失败 / 拒绝）—— 这些是错误信息，
 * 只展示给用户，不注入到后续角色的 prompt 上下文里。
 * （本函数是 sendTurn 准备 history 的入口，过滤后 buildChatContext
 *  拿到的 history 已经干净；context-builder 内部还会再过滤一次做双保险。） */
function buildHistory(rows: any[]): ChatHistoryItem[] {
  return rows
    .filter((r) => !isResultNotice(r.content))
    .map((r) => ({
      role: r.role as ChatRoomRole,
      characterName: r.characterName,
      content: r.content || '',
      // 错误信息标记：仅作"提示"，buildChatContext 会忽略 errorNotice 本身（context-builder 看不到错误信息）
      hasErrorNotice: !!r.errorNotice,
    }))
}

/** 生成单个角色的一条消息（落库占位 → 流式 → 落库最终内容+model_messages） */
async function generateCharacterMessage(args: {
  db: ReturnType<typeof getDb>
  roomId: string
  bookId: string
  bookTitle: string
  agentFallbackModelId: string | null
  participant: { id: string; characterId: string; characterName: string }
  history: ChatHistoryItem[]
  /** 仅「当前发言角色自己」的记忆状态（取自定稿记忆），不注入他人状态以避免上帝视角 */
  selfState: CharacterStateBrief | null
  /** 在场角色名字列表（用于「群聊成员」系统消息，明确作者与哪些角色同群） */
  participantNames: string[]
  /** 导演/用户给出的指令文本（空串表示无新指令，自动生成默认接话提示） */
  userInstruction: string
  /** 携带记录条数：注入模型上下文时最多取 history 末尾的 N 条 */
  historyLimit: number
  order: number
  out: ChatRoomMessage[]
}): Promise<ChatRoomMessage | null> {
  const { db, roomId, bookId, bookTitle, agentFallbackModelId, participant, history, selfState, participantNames, userInstruction, historyLimit, order, out } = args
  // 只携带最近 historyLimit 条对话进入模型上下文（控制连贯性 / 成本）
  const effectiveHistory = history.slice(-Math.max(1, historyLimit))
  const { name: characterName, setting: characterSetting } = getCharacterSetting(bookId, participant.characterId, participant.characterName)

  // 当前角色与"在场成员"的关系（过滤掉不在场的），用于让角色对谁亲疏有别
  const selfRelationships = getCharacterRelationships(bookId, participant.characterId)
    .filter((r) => participantNames.includes(r.targetName))
    .map((r) => `- ${r.targetName}：${r.typeLabel}`)
    .join('\n') || null

  const model = resolveChatRoomModel({
    bookId,
    roomId,
    characterId: participant.characterId,
    agentFallbackModelId: agentFallbackModelId ?? null,
  })

  // 系统聊天指示词：有导演指令则带上，并提醒轮到该角色发言；否则给默认接话提示
  const instructionWord = userInstruction.trim()
    ? `轮到你发言，请承接上文、自然接一句话。`
    : `请基于以上你自己的状态与对话，自然接一句话。`

  const { messages: llmMessages } = buildChatContext({
    bookId,
    bookTitle,
    characterName,
    characterSetting,
    history: effectiveHistory,
    selfState,
    participantNames,
    selfRelationships,
    instructionWord,
  })

  // 先建占位消息（role=character, content=''），用其 id 做流式目标
  const msgId = uuidv4()
  const ts = now()
  db.insert(chatRoomMessages).values({
    id: msgId,
    roomId,
    order,
    role: 'character',
    characterId: participant.characterId,
    characterName,
    content: '',
    modelId: null,
    createdAt: ts,
  }).run()

  emit('chatRoom:messageStart', {
    roomId,
    messageId: msgId,
    characterId: participant.characterId,
    characterName,
    order,
  })

  // 流式调用
  let acc = ''
  let usage: any = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, reasoningTokens: 0 }
  let reasoning = ''
  let finishReason: any = null
  try {
    const result = await runAgentModel({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelName: model.modelName,
      messages: llmMessages,
      // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 聊天室内置默认 0.9
      ...resolveSamplingParams(model, 'chatRoom'),
      stream: true,
      mergeSystemMessages: model.mergeSystemMessages,
    }, {
      onChunk: (delta) => {
        if (!delta) return
        acc += delta
        emit('chatRoom:messageDelta', { roomId, messageId: msgId, delta })
      },
      onReasoning: (delta) => {
        if (!delta) return
        reasoning += delta
        emit('chatRoom:messageReasoning', { roomId, messageId: msgId, delta })
      },
    })
    usage = result.usage || usage
    reasoning = result.reasoning || reasoning
    finishReason = result.finishReason ?? null
  } catch (err: any) {
    // 模型调用失败：保留卡片，展示错误提示（用户要求即使出错也要有卡片），
    // 仍存 modelMessages 便于"查看上下文"排查；不删占位、不抛错，避免中断整轮。
    // 关键：流式 onChunk 已累加的部分（acc）必须保留到 content，错误信息走 errorNotice 列
    // —— 与 role-dialogue 的"已生成内容 + 错误信息同时保留"行为对齐。
    // 之前直接把 content 覆盖为错误消息，会把 content_filter 截断前已产出的 60-100 字剧情吞掉。
    // 同样：stream 截断前 provider 已返回的 usage（如 content_filter 触发时仍有 promptTokens / 部分 completionTokens）也必须落 token_log，
    // 否则用户在主菜单"消费记录"看不到这次消耗的钱。
    //
    // AgentModelError 携带了流式过程中已累积的 content/reasoning/usage/finishReason（来自 worker 的部分结果），
    // 用这些值更新本地变量，确保即使异常路径也能拿到完整的思考过程和准确的 token 统计。
    if (err instanceof AgentModelError && err.partialResult) {
      acc = acc || err.partialResult.content || ''
      reasoning = reasoning || err.partialResult.reasoning || ''
      usage = err.partialResult.usage || usage
      finishReason = err.partialResult.finishReason ?? finishReason
    }
    const errMsg = String(err?.message || err)
    const accTrimmed = (acc || '').trim()
    const noticeText = `${ERROR_RESULT_PREFIX}${errMsg}）`
    const updateTs = now()
    const usageObj = computeChatUsage(usage, model)
    const systemRequestText = (llmMessages.find((m) => m.role === 'system')?.content || '').slice(0, 500)
    const userRequestText = (llmMessages.find((m) => m.role === 'user')?.content || '').slice(-500)
    db.update(chatRoomMessages)
      .set({
        content: accTrimmed || noticeText, // 部分产出保留；空产出时整气泡是错误消息
        errorNotice: accTrimmed ? noticeText : null, // 有内容时错误信息独立
        modelId: model.id,
        modelMessages: JSON.stringify(llmMessages),
        // 推理模型的"思考过程"完整文本：即使模型调用失败（content_filter / 中断），已流式收到的 reasoning 也要落库供用户查看。
        reasoning: (reasoning || '').trim() || null,
        usage: JSON.stringify(usageObj),
        createdAt: updateTs,
      })
      .where(eq(chatRoomMessages.id, msgId))
      .run()
    const finalRow = db.select().from(chatRoomMessages).where(eq(chatRoomMessages.id, msgId)).get()
    const finalMsg = serializeMessage(finalRow)
    out.push(finalMsg)
    emit('chatRoom:messageComplete', { roomId, messageId: msgId, message: finalMsg })
    // 即使模型调用失败，stream 截断前 provider 已部分消耗（prompt 已发、completion 可能部分收），
    // 仍写入 token 消耗记录（供主菜单汇总）—— 与成功路径 finishMessage 行为对齐。
    writeTokenLog({
      bookId,
      modelId: model.id,
      modelName: model.modelName,
      usageObj,
      bookTitle,
      characterName,
      systemRequestText,
      userRequestText,
    })
    return finalMsg
  }

  // 计算本条消息的 token 消耗（成功 / 空结果都会落库 usage；失败分支已在上面 return，已补写日志）
  const usageObj = computeChatUsage(usage, model)

  // 模型调用上下文文本摘要（两条分支复用，供 token 日志留存）
  const systemRequestText = (llmMessages.find((m) => m.role === 'system')?.content || '').slice(0, 500)
  const userRequestText = (llmMessages.find((m) => m.role === 'user')?.content || '').slice(-500)

  const finishMessage = (content: string, errorNotice: string | null = null) => {
    const updateTs = now()
    db.update(chatRoomMessages)
      .set({
        content,
        errorNotice,
        modelId: model.id,
        // 把实际发给模型的 messages 数组存下来，供前端"查看上下文"
        modelMessages: JSON.stringify(llmMessages),
        // 推理模型的"思考过程"完整文本：让用户能查看模型推理过程。流式实时显示由 onReasoning emit 完成。
        reasoning: (reasoning || '').trim() || null,
        usage: JSON.stringify(usageObj),
        createdAt: updateTs,
      })
      .where(eq(chatRoomMessages.id, msgId))
      .run()
    const finalRow = db.select().from(chatRoomMessages).where(eq(chatRoomMessages.id, msgId)).get()
    const finalMsg = serializeMessage(finalRow)
    out.push(finalMsg)
    emit('chatRoom:messageComplete', { roomId, messageId: msgId, message: finalMsg })
    // 即使返回为空，输入 token 也已消耗，仍写入 token 消耗记录（供主菜单汇总）
    writeTokenLog({
      bookId,
      modelId: model.id,
      modelName: model.modelName,
      usageObj,
      bookTitle,
      characterName,
      systemRequestText,
      userRequestText,
    })
    return finalMsg
  }

  // 清洗并落库最终内容
  const finalContent = cleanCharacterLine(acc, characterName)
  if (!finalContent) {
    // 兜底：模型这一波连 reasoning 都不返（acc 为空）时，
    // 退而用 worker 内部累加的 reasoning 文本作内容兜底，
    // 避免直接落 EMPTY_RESULT_MARKER 而被"提前结束"。
    const reasoningFallback = cleanCharacterLine((reasoning || '').trim(), characterName)
    if (reasoningFallback) {
      return finishMessage(reasoningFallback)
    }
    // 关键原则（与 role-dialogue 一致）：流式 onChunk 已累加的部分（acc）即使被 cleanCharacterLine 洗空，
    // 也必须保留到 content，让用户看到"模型实际输出了什么"。错误信息走 errorNotice 列独立。
    const accTrimmed = (acc || '').trim()
    // 模型主动拒绝生成（finishReason 表示 provider 因内容审核 / 安全策略没生成任何内容）：
    // 直接把 finishReason 当作"原因字符串"展示在卡片上，不做翻译。
    if (finishReason) {
      const refusedText = REFUSED_RESULT_PREFIX + finishReason + '）'
      if (accTrimmed) {
        return finishMessage(accTrimmed, refusedText)
      }
      return finishMessage(refusedText)
    }
    // 模型空输出：保留卡片，展示空结果提示（用户要求即使空也要有卡片），
    // 同时仍存 modelMessages 便于"查看上下文"排查为什么空。
    if (accTrimmed) {
      // 罕见：finishReason 也没、cleanCharacterLine 洗空、但 acc 仍有原始内容（比如整段被剥前缀）
      return finishMessage(accTrimmed, EMPTY_RESULT_MARKER)
    }
    return finishMessage(EMPTY_RESULT_MARKER)
  }

  return finishMessage(finalContent)
}

export async function sendTurn(input: SendTurnInput): Promise<ChatRoomMessage[]> {
  const { roomId, userContent, agentFallbackModelId, sender } = input
  const trimmedUser = (userContent || '').trim()
  const senderRole = sender?.role ?? 'director'

  if (generatingRooms.has(roomId)) {
    throw new Error('该聊天室正在生成回复，请稍候再发。')
  }
  generatingRooms.add(roomId)

  const db = getDb()
  const newMessages: ChatRoomMessage[] = []

  try {
    const room = db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, roomId)).get()
    if (!room) throw new Error(`聊天室房间不存在：${roomId}`)
    const book = db.select().from(books).where(eq(books.id, room.bookId)).get()
    if (!book) throw new Error(`书籍不存在：${room.bookId}`)
    const bookTitle = book.title || '未命名作品'
    const speakingMode: ChatRoomSpeakingMode = (room.speakingMode as ChatRoomSpeakingMode) || 'sequential'

    // 1. 落库用户/扮演者消息（如有）
    if (trimmedUser) {
      const order = nextOrder(db, roomId)
      const id = uuidv4()
      const ts = now()
      const isCharacter = senderRole === 'character'
      db.insert(chatRoomMessages).values({
        id,
        roomId,
        order,
        role: senderRole,
        characterId: isCharacter ? (sender as any).characterId ?? null : null,
        characterName: isCharacter ? (sender as any).characterName ?? null : null,
        content: trimmedUser,
        modelId: null,
        createdAt: ts,
      }).run()
      newMessages.push(serializeMessage(
        db.select().from(chatRoomMessages).where(eq(chatRoomMessages.id, id)).get(),
      ))
    }

    // 2. 取在场角色（按发言顺序）
    const participants = db.select().from(chatRoomParticipants)
      .where(eq(chatRoomParticipants.roomId, roomId))
      .orderBy(chatRoomParticipants.sortOrder as any)
      .all()

    // 房间内全部角色的记忆最后状态（注入每个角色发言的上下文第一条系统消息）
    const allStates = getAllCharacterMemoryStates(room.bookId, participants.map((p) => p.characterId))

    // 决定本轮哪些角色需要接话：
    // - 导演/作者/网友发言：所有在场角色都来接话（按设置的依次/同时方式）
    // - 以某角色身份发言：该角色本轮已说了这句，其余在场角色都应接话，
    //   不再按排序位置截断（旧逻辑只让"该角色之后"的角色接话，导致它前面的角色不回应）
    let speakers: typeof participants
    if (senderRole === 'character' && trimmedUser) {
      const playedId = (sender as any).characterId
      speakers = participants.filter((p) => p.characterId !== playedId)
    } else {
      speakers = participants
    }

    // 若既没有用户输入也没有在场角色，直接结束
    if (!trimmedUser && participants.length === 0) {
      emit('chatRoom:turnDone', { roomId, messages: newMessages })
      return newMessages
    }

    // 历史转录：先把本房间已有全部消息 + 本轮已落库的用户消息拼成 history
    const existingRows = db.select().from(chatRoomMessages)
      .where(eq(chatRoomMessages.roomId, roomId))
      .orderBy(chatRoomMessages.order as any)
      .all()
    const history: ChatHistoryItem[] = buildHistory(existingRows)

    // 预分配本轮各角色的 order（避免并行时冲突）
    let baseOrder = nextOrder(db, roomId)
    const orderByParticipant = new Map<string, number>()
    speakers.forEach((p, idx) => orderByParticipant.set(p.id, baseOrder + idx))

    const genArgs = (p: typeof participants[number], historyForChar: ChatHistoryItem[]) => ({
      db,
      roomId,
      bookId: room.bookId,
      bookTitle,
      agentFallbackModelId: agentFallbackModelId ?? null,
      participant: { id: p.id, characterId: p.characterId, characterName: p.characterName },
      history: historyForChar,
      // 只把"当前这个角色自己的状态"注入上下文，避免它读到其他角色的私密状态（上帝视角）
      selfState: allStates.find((s) => s.characterId === p.characterId) ?? null,
      participantNames: participants.map((p) => p.characterName),
      userInstruction: trimmedUser,
      historyLimit: room.historyLimit || 50,
      order: orderByParticipant.get(p.id)!,
      out: newMessages,
    })

    if (speakingMode === 'simultaneous') {
      // 同时发言：所有角色基于同一份历史并行生成（彼此看不到对方的本轮发言）
      await Promise.allSettled(speakers.map((p) => generateCharacterMessage(genArgs(p, history))))
    } else {
      // 依次发言：串行，每个角色能看到前序角色的发言
      for (const p of speakers) {
        const m = await generateCharacterMessage(genArgs(p, history))
        // 空结果 / 失败提示卡片只是展示，不进入后续角色的历史上下文
        if (m && !isResultNotice(m.content)) {
          history.push({ role: 'character', characterName: m.characterName, content: m.content })
        }
      }
    }

    emit('chatRoom:turnDone', { roomId, messages: newMessages })
    return newMessages
  } finally {
    generatingRooms.delete(roomId)
  }
}

/**
 * 让单个在场角色基于当前历史单独说一句（角色卡片上的"发言"按钮触发）。
 */
export async function characterSpeak(roomId: string, characterId: string): Promise<ChatRoomMessage[]> {
  if (generatingRooms.has(roomId)) {
    throw new Error('该聊天室正在生成回复，请稍候再发。')
  }
  generatingRooms.add(roomId)

  const db = getDb()
  const newMessages: ChatRoomMessage[] = []

  try {
    const room = db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, roomId)).get()
    if (!room) throw new Error(`聊天室房间不存在：${roomId}`)
    const book = db.select().from(books).where(eq(books.id, room.bookId)).get()
    if (!book) throw new Error(`书籍不存在：${room.bookId}`)
    const bookTitle = book.title || '未命名作品'

    const participant = db.select().from(chatRoomParticipants)
      .where(and(
        eq(chatRoomParticipants.roomId, roomId),
        eq(chatRoomParticipants.characterId, characterId),
      ))
      .get()
    if (!participant) throw new Error('该角色不在在场列表中')

    // 房间内全部角色的记忆最后状态（含本角色，注入上下文第一条系统消息）
    const allRoomParticipants = db.select({ characterId: chatRoomParticipants.characterId, characterName: chatRoomParticipants.characterName })
      .from(chatRoomParticipants)
      .where(eq(chatRoomParticipants.roomId, roomId))
      .all()
    const allStates = getAllCharacterMemoryStates(room.bookId, allRoomParticipants.map((p) => p.characterId))

    const existingRows = db.select().from(chatRoomMessages)
      .where(eq(chatRoomMessages.roomId, roomId))
      .orderBy(chatRoomMessages.order as any)
      .all()
    const history: ChatHistoryItem[] = buildHistory(existingRows)

    const order = nextOrder(db, roomId)
    await generateCharacterMessage({
      db,
      roomId,
      bookId: room.bookId,
      bookTitle,
      agentFallbackModelId: null,
      participant: { id: participant.id, characterId: participant.characterId, characterName: participant.characterName },
      history,
      // 只注入当前角色自己的状态，避免上帝视角
      selfState: allStates.find((s) => s.characterId === participant.characterId) ?? null,
      participantNames: allRoomParticipants.map((p) => p.characterName),
      userInstruction: '',
      historyLimit: room.historyLimit || 50,
      order,
      out: newMessages,
    })

    emit('chatRoom:turnDone', { roomId, messages: newMessages })
    return newMessages
  } finally {
    generatingRooms.delete(roomId)
  }
}
