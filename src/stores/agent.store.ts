/**
 * 新建书时的聊天记录归属处理：
 *
 * 产品约定：一旦创建了第一本书，用户就无法再回到"无书"状态（除非删掉所有书籍）。
 * 因此 `global`（无书状态）桶里的聊天记录在有书之后不再有可访问入口 —— 用户切到任何一本书都看不到，
 * 也不能再切到"无书"视图。为了避免这段历史彻底"看不见"，我们在**第一次创建书**时把 `global` 桶的
 * **全部**记录整体搬到新书桶，让用户切到新书后就能看到之前的所有对话。
 *
 * 当从"上一本书"新建下一本书时，`prevBookId` 是上一本书的 id（不是 global），上一本书还能通过侧边栏访问，
 * 所以只需要把"本次立项讨论的最近一小段"复制到新书即可，避免把上一本书的历史都搬走。
 *
 * 综上：
 *   - `prevBookId === null`（即当前在 `global` 桶）→ **整桶 move** 到新书（原桶清空，反正也访问不到了）
 *   - `prevBookId !== null`（当前在其他书里）→ **切片 copy**：从 anchorMessageId 往前找到最近一条 user 消息，
 *     从它到 anchor 这一小段（本次立项讨论）复制到新书；上一本书桶保留全部原始记录
 */
async function relocateChatOnBookCreate(
  prevBookId: string | null,
  newBookId: string,
  anchorMessageId: string,
  get: () => AgentState,
): Promise<void> {
  const state = get()
  const messages = state.messages

  // 情况 A：当前无书 → 把 global 整桶 move 到新书
  if (prevBookId === null) {
    // 先把内存最新快照落库到 global，确保 move 能带走最新的一份
    await get().saveMessages(null)
    await window.api.chatMessage.move({ fromBookId: 'global', toBookId: newBookId })
    console.log('[agent.store] moved entire global chat bucket to new book', {
      newBookId,
      totalMessages: messages.length,
    })
    return
  }

  // 情况 B：从上一本书里新建下一本书 → 只复制"本次立项讨论"的切片
  const anchorIdx = messages.findIndex((m) => m.id === anchorMessageId)
  if (anchorIdx < 0) return

  // 从 anchor 向前找到最近的一条 user 消息作为切片起点
  let sliceStart = anchorIdx
  for (let i = anchorIdx; i >= 0; i--) {
    if (messages[i].role === 'user') {
      sliceStart = i
      break
    }
  }
  const toCopy = messages.slice(sliceStart)
  if (toCopy.length === 0) return

  await get().saveMessages(prevBookId)

  const ids = toCopy.map((m) => m.id)
  await window.api.chatMessage.copyByIds({ messageIds: ids, toBookId: newBookId })
  console.log('[agent.store] copied 立项 slice to new book (previous book bucket preserved)', {
    prevBookId,
    newBookId,
    copiedCount: ids.length,
    totalMessages: messages.length,
  })
}

/**
 * Agent Store
 *
 * 管理新 Agent 聊天界面的消息状态、流式接收、工具调用进度、PendingWrite 应用
 */

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { AgentMessage, PendingWrite, AgentToolCall, AgentToolResult, ApplyResult } from '@/types/agent'
import { useWorkspaceStore } from './workspace.store'
import { getAiOutputLanguageSetting, getAiContextDepthSetting, getAiInjectWritingSettingsSetting, getAiChatHistoryLimitSetting, getAiStreamTimeoutSetting, getAiWriteContextSettings } from './aiSettings.store'

type ActiveRun = {
  streamId: string
  bookId: string | null
  userInput: string
  startedAt: number
}

type AgentState = {
  messages: AgentMessage[]
  activeRun: ActiveRun | null
  /** 当前正在流的 AI 消息 ID */
  streamingMessageId: string | null

  /** 发送消息并启动 Agent */
  sendMessage: (opts: {
    bookId: string | null
    modelId: string
    chapterId?: string | null
    volumeId?: string | null
    /** 按场景勾选的文风指纹 id（优先于本书激活指纹）；不传则用激活指纹 */
    styleFingerprintId?: string | null
    /** 定稿流程标记：编辑器「定稿」按钮触发，由 Agent 确定性生成章节记忆 */
    finalize?: boolean
    /** 发给模型的完整消息（可以携带 chapterId 等技术细节） */
    userInput: string
    /**
     * 展示在聊天记录里的用户消息内容。默认与 userInput 相同。
     * 用于"按钮发起的对话"这类场景——比如定稿按钮发送时携带 chapterId 让模型能定位，
     * 但界面上只显示"请为章节《X》完成定稿"，避免技术细节暴露给用户。
     */
    displayInput?: string
    /**
     * 是否为"自动续跑"触发的消息。true 时不重置熔断计数，且标记 userMessage.autoResumed，
     * 用于 UI 上给这条用户消息一个"由 AI 应用自动触发"的视觉提示。
     */
    autoResumed?: boolean
    /**
     * 已应用的 pendingWrite 类型列表，用于 auto-resume 时注入下一步工具提示词。
     * 如 ['chapter_list'] 表示刚应用了创建章节的结果。
     */
    appliedPendingWriteTypes?: string[]
  }) => Promise<void>

  /** 停止运行 */
  stopRun: () => Promise<void>

  /** 应用单个 PendingWrite（可传入修改后的 data） */
  applyWrite: (messageId: string, writeId: string, modelId?: string, modifiedData?: any) => Promise<ApplyResult | undefined>

  /** 批量应用所有 PendingWrite */
  applyAll: (messageId: string, modelId?: string) => Promise<any>

  /** 放弃单个 PendingWrite（从消息 pendingWrites 数组彻底移除） */
  discardWrite: (messageId: string, writeId: string) => void

  /**
   * 重跑：让模型重新调一次同名工具。用户填了"重跑原因"后调用。
   * 行为：移除该卡片 → 以用户身份发一条"请按以下原因重新调用 request_user_confirmation：${reason}"，模型重新调本工具。
   */
  rerunWrite: (messageId: string, writeId: string, reason: string) => Promise<void>

  /**
   * 拒绝：用户拒绝此卡片，整条链路停止。
   * 行为：标记卡片为 rejected（前端展示"已拒绝：原因"）→ 以用户身份发一条"用户已拒绝 ${title}，原因：${reason}，请停止整条链路"消息。
   */
  rejectWrite: (messageId: string, writeId: string, reason: string) => Promise<void>

  /** 清空消息 */
  clearMessages: () => void

  /** 设置消息（从持久化恢复时用） */
  setMessages: (messages: AgentMessage[]) => void

  /** 加载历史消息 */
  loadMessages: (bookId: string | null) => Promise<void>

  /** 保存消息到数据库 */
  saveMessages: (bookId: string | null) => Promise<void>

  /** 批量更新流式内容（用于防抖） */
  updateStreamingContent: (messageId: string, content: string) => void
}

// 防抖定时器
let streamingDebounceTimer: ReturnType<typeof setTimeout> | null = null
// 流式内容累加缓冲（防抖只做节流，绝不丢 chunk）
let streamingContentBuffer = ''
// 推理模型"思考过程"的流式缓冲（与正文共用同一套防抖节奏）
let streamingReasoningBuffer = ''
let streamingReasoningDebounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 50

/**
 * 从流式文本中提取工具调用（支持多种输出格式），返回清洗后的内容和提取的工具调用。
 *
 * 处理策略：
 *   1. ```tool_call ... ``` 代码块 → 解析并移除
 *   2. 未闭合的 ```tool_call → 移除（流式截断）
 *   3. <tool_call>...</tool_call> XML 标签 → 解析并移除
 *   4. ```json ... ``` 代码块 → 整体移除
 *   5. 无语言代码块中含工具字段 → 解析并移除
 *   6. 裸露 JSON 数组/对象（含工具字段）→ 括号栈匹配后移除
 */
function parseToolCallBlocks(raw: string): {
  cleaned: string
  blocks: Array<{ name: string; arguments: Record<string, any> }>
} {
  const blocks: Array<{ name: string; arguments: Record<string, any> }> = []

  const collectFromJson = (jsonStr: string) => {
    const trimmed = jsonStr.trim()
    if (!trimmed) return
    try {
      const parsed = JSON.parse(trimmed)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        if (!item) continue
        let args: Record<string, any> = {}
        if (typeof item.arguments === 'string') {
          try { args = JSON.parse(item.arguments) } catch { args = { _raw: item.arguments } }
        } else if (item.arguments && typeof item.arguments === 'object') {
          args = item.arguments
        } else if (item.function?.arguments) {
          if (typeof item.function.arguments === 'string') {
            try { args = JSON.parse(item.function.arguments) } catch { args = { _raw: item.function.arguments } }
          } else if (typeof item.function.arguments === 'object') {
            args = item.function.arguments
          }
        }
        const name = item.name || item.tool || item.tool_name || item.function?.name || item.function_call?.name
        if (!name) continue
        blocks.push({ name, arguments: args })
      }
    } catch {
      // JSON 解析失败（可能是流式截断的碎片），静默丢弃
    }
  }

  // 第一步：移除所有完成的 ```tool_call ... ``` 块并解析
  let cleaned = raw.replace(/```tool_call\s*\n?([\s\S]*?)```\s*\n?/gi, (_, jsonStr) => {
    collectFromJson(jsonStr)
    return ''
  })

  // 第二步：移除未闭合的 ```tool_call（流式截断残留）
  cleaned = cleaned.replace(/```tool_call\s*[\s\S]*?$/gi, '')

  // 第三步：移除 <tool_call>...</tool_call> XML 标签
  cleaned = cleaned.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (_, body) => {
    collectFromJson(body)
    return ''
  })
  cleaned = cleaned.replace(/<tool_call>\s*[\s\S]*?$/i, '')

  // 第四步：移除 ```json ... ``` 代码块（纯 JSON 数据不应展示）
  cleaned = cleaned.replace(/```json\s*\n?([\s\S]*?)```\s*\n?/gi, (_, body) => {
    if (/"(name|tool|tool_name|tool_calls|function)"\s*:/.test(body)) {
      collectFromJson(body)
    }
    return ''
  })
  cleaned = cleaned.replace(/```json\s*[\s\S]*?$/gi, '')

  // 第五步：移除无语言代码块中包含工具调用字段的 JSON
  cleaned = cleaned.replace(/```\s*\n([\s\S]*?)```\s*\n?/g, (match, body) => {
    const trimmed = String(body).trim()
    if (/"(name|tool|tool_name|tool_calls|function)"\s*:/.test(trimmed)) {
      collectFromJson(trimmed)
      return ''
    }
    return match
  })

  // 第六步：移除裸露的 JSON 数组/对象（含工具调用字段）
  const stripBareJson = (text: string): string => {
    const re = /[\[{]/g
    let result = text
    const toRemove: Array<[number, number]> = []
    let match: RegExpExecArray | null
    while ((match = re.exec(result)) !== null) {
      const start = match.index
      let depth = 0
      let inString = false
      let escapeNext = false
      let end = -1
      for (let i = start; i < result.length; i++) {
        const ch = result[i]
        if (escapeNext) { escapeNext = false; continue }
        if (ch === '\\' && inString) { escapeNext = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === '{' || ch === '[') depth++
        else if (ch === '}' || ch === ']') {
          depth--
          if (depth === 0) { end = i + 1; break }
        }
      }
      if (end < 0) break
      const candidate = result.slice(start, end)
      if (/"(name|tool|tool_name|tool_calls|function)"\s*:/.test(candidate)) {
        try {
          JSON.parse(candidate)
          collectFromJson(candidate)
          toRemove.push([start, end])
        } catch { /* 不是合法 JSON，跳过 */ }
      }
      re.lastIndex = end
    }
    if (toRemove.length === 0) return result
    let out = ''
    let cursor = 0
    for (const [s, e] of toRemove) {
      out += result.slice(cursor, s)
      cursor = e
    }
    out += result.slice(cursor)
    return out
  }
  cleaned = stripBareJson(cleaned).trim()

  return { cleaned, blocks }
}

// ─── 自动续跑（Resume After Apply）─────────────────────────────
//
// 用户点应用后，前端会以用户身份自动发一条"已应用结果，请继续。"，让模型接着执行下一步。
// 触发条件（卡级前置协议）：
//   1. 当前消息里至少有一张 PendingWrite 的 isPrerequisite === true（模型在产出这张卡时同时声明了它是前置步骤）
//   2. 所有 isPrerequisite === true 的卡都已 applied（独立卡是否 applied 不影响触发）
//   3. 未超过熔断阈值 MAX_AUTO_RESUME_CHAIN
//
// 熔断：一条用户主动消息之后连续自动续跑不得超过 MAX_AUTO_RESUME_CHAIN 次，
// 用 resumeChainCount 记录连续次数。任何一次由用户主动发起的 sendMessage 都会把它重置为 0。
const MAX_AUTO_RESUME_CHAIN = 5
let resumeChainCount = 0
// 已经触发过续跑的 messageId 集合，防止同一条消息重复触发（比如 applyWrite / applyAll 同时命中）
const triggeredResumeMessageIds = new Set<string>()

/** 消息是否满足自动续跑触发条件
 *
 * 新协议：卡级 isPrerequisite —— 只要本消息里有任何一张 `isPrerequisite === true` 的卡片存在，
 * 且**所有前置卡都已应用**（独立卡不参与判定），就触发续跑。
 * 这样：
 *   1. 用户可以只应用前置卡就让 AI 继续，不必等独立卡也应用；
 *   2. 独立卡未应用也不阻塞多步骤任务的自动推进。
 */
function shouldAutoResume(message: AgentMessage | undefined): boolean {
  if (!message) return false
  if (triggeredResumeMessageIds.has(message.id)) return false
  const writes = message.pendingWrites || []
  const prerequisites = writes.filter((w) => (w as any).isPrerequisite === true)
  if (prerequisites.length === 0) return false
  return prerequisites.every((w) => w.applied)
}

/**
 * 应用动作完成后调用，判断是否应该以用户身份发送"已应用结果，请继续。"
 * 仅 applyWrite / applyAll 会触发（此时 modelId 一定有值）。放弃动作不触发。
 */
async function maybeTriggerAutoResume(
  messageId: string,
  modelId: string | undefined,
  getStore: () => AgentState,
  send: AgentState['sendMessage'],
) {
  if (!modelId) return
  const state = getStore()
  const message = state.messages.find((m) => m.id === messageId)
  if (!shouldAutoResume(message)) return

  // 防丢保护：若当前仍有运行中的请求（sendMessage 会因 activeRun 直接忽略调用），
  // 此时**不消耗触发资格**（不标记 triggeredResumeMessageIds、不加计数），直接跳过。
  // 否则续跑会被静默吞掉且永远无法再触发。正常情况下流式期间应用按钮已禁用，不会走到这里。
  if (state.activeRun) return

  // 熔断：连续自动续跑不能超过 MAX_AUTO_RESUME_CHAIN 次
  if (resumeChainCount >= MAX_AUTO_RESUME_CHAIN) {
    console.warn('[agent.store] 已连续自动续跑', MAX_AUTO_RESUME_CHAIN, '次，本次不再触发。请手动确认是否继续。')
    return
  }

  // 标记本消息已触发，避免同一条消息被多个应用动作重复触发
  triggeredResumeMessageIds.add(messageId)
  resumeChainCount += 1

  const bookId = getStore().activeRun?.bookId ?? useWorkspaceStore.getState().currentBookId ?? null

  // 从已应用的前置卡片构建续跑说明，让模型知道"刚才应用了什么，接下来该做什么"
  const appliedPrerequisites = (message?.pendingWrites || [])
    .filter((w) => w.isPrerequisite && w.applied)
  const appliedTypes = appliedPrerequisites
    .map((w) => (w as any).type)
    .filter(Boolean) as string[]
  const appliedHint = appliedPrerequisites.length > 0
    ? `（${appliedPrerequisites.map(w => w.title).filter(Boolean).join('、')}）`
    : ''
  await send({
    bookId,
    modelId,
    userInput: `已应用结果${appliedHint}，请继续完成最初目标的下一步。直接执行，无需再次确认。注意：只执行完成最初目标所缺少的必要步骤；若最初目标已全部完成，直接回复完成情况总结即可，不要执行任何额外操作。`,
    // UI 展示用简短文案（详细指令在 userInput 里给模型）
    displayInput: `已应用${appliedHint || '结果'}，请继续。`,
    autoResumed: true,
    appliedPendingWriteTypes: appliedTypes,
  })
}



/**
 * PendingWrite 应用完毕后，按 write.type 扇出刷新，让主编辑区 / 大纲 / 分卷 / 章节列表 /
 * 设定页等场景订阅方能立刻看到最新数据。
 *
 * 复用两个既有的 window 事件：
 *   - `ai-result-applied` —— Editor / Outline / BookSettingEntryPage 都在监听
 *   - `chapters-updated`  —— Chapters 页在监听
 * 结合 workspaceStore 的 loadChapters / loadVolumes / loadStats，让 zustand 订阅者自动重渲染。
 */
async function refreshAfterApply(write: PendingWrite) {
  const ws = useWorkspaceStore.getState()
  const bookId = (write.target as any)?.bookId || ws.currentBookId || null

  switch (write.type) {
    case 'book_info':
      // applyWrite 外层已经调过 loadBooks；这里补一次 outline/settings 场景常见的兜底事件
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    case 'book_outline':
      // 书籍大纲：Outline 页 & Editor 侧栏"当前章大纲/卷大纲"依赖 ai-result-applied 重新拉取
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    case 'volume_list':
    case 'volume_outline':
      // 分卷相关：Volumes 页从 workspaceStore 读 volumes，直接刷新 store；Editor 也需要感知
      if (bookId) await ws.loadVolumes(bookId)
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    case 'chapter_list':
    case 'chapter_outline':
    case 'chapter_content':
      // 章节列表/大纲/正文：workspaceStore 刷新 chapters + stats；同时通知 Chapters 页与 Editor
      if (bookId) {
        await ws.loadChapters(bookId)
        await ws.loadStats(bookId)
      }
      window.dispatchEvent(new Event('chapters-updated'))
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    case 'book_setting':
      // 设定条目：角色/地点/物品等设定页监听 book-settings-updated
      window.dispatchEvent(new Event('book-settings-updated'))
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    case 'delete_entity': {
      // 删除按目标类型分派：删章节要重拉 chapters，删分卷要重拉 volumes，删书要重拉 books
      const t = (write.target as any)?.entityType
      if (t === 'chapter' && bookId) {
        await ws.loadChapters(bookId)
        await ws.loadStats(bookId)
        window.dispatchEvent(new Event('chapters-updated'))
      } else if (t === 'volume' && bookId) {
        await ws.loadVolumes(bookId)
      } else if (t === 'book') {
        await ws.loadBooks()
      } else if (t === 'setting') {
        window.dispatchEvent(new Event('book-settings-updated'))
      }
      window.dispatchEvent(new Event('ai-result-applied'))
      break
    }

    case 'chapter_snapshot':
      // 快照：主进程虽然会广播 ai:snapshotGenerated，但只在 chapterId 命中 currentChapter 时触发
      // Editor 页面的 loadChapters；这里主动再刷一次 workspaceStore.chapters + 事件，确保
      // 「定稿」按钮和只读态可靠切换。
      if (bookId) {
        await ws.loadChapters(bookId)
        await ws.loadStats(bookId)
      }
      window.dispatchEvent(new Event('chapters-updated'))
      window.dispatchEvent(new Event('ai-result-applied'))
      break

    default:
      break
  }
}

// PendingWrite 类型到中文标签的映射
const WRITE_TYPE_LABELS: Record<string, string> = {
  book_info: '书籍信息',
  book_outline: '书籍大纲',
  volume_list: '分卷列表',
  volume_outline: '分卷大纲',
  chapter_list: '章节列表',
  chapter_outline: '章节大纲',
  chapter_content: '章节正文',
  book_setting: '设定条目',
  delete_entity: '删除操作',
  chapter_snapshot: '章节记忆',
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  activeRun: null,
  streamingMessageId: null,

  sendMessage: async (opts) => {
    const userInput = opts.userInput.trim()
    if (!userInput || !opts.modelId) return
    // 防止并发：已有运行在进行时，忽略新的发送请求（避免重复点击 / 编辑器定稿与对话互相抢占）
    if (get().activeRun) return
    // 展示在聊天记录里的内容（若未提供 displayInput 则用完整 userInput）
    const displayInput = (opts.displayInput || opts.userInput).trim()

    // 用户主动发起的对话会把连续自动续跑计数重置为 0；只有 autoResumed=true 的调用不重置
    if (!opts.autoResumed) {
      resumeChainCount = 0
    }

    // 创建用户消息（UI 展示用 displayInput；发给模型的仍是 userInput）
    const userMessage: AgentMessage = {
      id: uuidv4(),
      role: 'user',
      content: displayInput,
      autoResumed: opts.autoResumed,
      modelId: opts.modelId,
      createdAt: Date.now(),
    }

    // 创建 AI 消息（占位，等待流式填充）
    const aiMessageId = uuidv4()
    const aiMessage: AgentMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      streaming: true,
      toolCalls: [],
      pendingWrites: [],
      createdAt: Date.now(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage, aiMessage],
      streamingMessageId: aiMessageId,
    }))

    // 注册事件监听
    const streamId = uuidv4()
    set({ activeRun: { streamId, bookId: opts.bookId, userInput, startedAt: Date.now() } })

    // 重置流式缓冲（每次 run 都从空开始累加，避免上一轮残留）
    streamingContentBuffer = ''
    if (streamingDebounceTimer) {
      clearTimeout(streamingDebounceTimer)
      streamingDebounceTimer = null
    }
    streamingReasoningBuffer = ''
    if (streamingReasoningDebounceTimer) {
      clearTimeout(streamingReasoningDebounceTimer)
      streamingReasoningDebounceTimer = null
    }

    // 监听流式事件
    const unlistenChunk = window.api.agent.onChunk((data) => {
      if (data.streamId !== streamId) return
      streamingContentBuffer += data.delta

      if (streamingDebounceTimer) return

      streamingDebounceTimer = setTimeout(() => {
        streamingDebounceTimer = null
        const raw = streamingContentBuffer
        const { cleaned, blocks } = parseToolCallBlocks(raw)
        set((state) => {
          const existingTcs = state.messages.find((m) => m.id === aiMessageId)?.toolCalls || []
          if (blocks.length === 0 && cleaned === raw) return {}
          const existingKeys = new Set(existingTcs.map(tc => `${tc.call.name}:${JSON.stringify(tc.call.arguments)}`))
          const mergedTcs = [...existingTcs]
          for (const block of blocks) {
            const key = `${block.name}:${JSON.stringify(block.arguments)}`
            if (existingKeys.has(key)) continue
            existingKeys.add(key)
            const callId = `tc_${Date.now()}_${mergedTcs.length}`
            mergedTcs.push({
              call: { id: callId, name: block.name, arguments: block.arguments },
              result: { id: callId, name: block.name, success: false, data: null },
              startedAt: Date.now(),
            })
          }
          return {
            messages: state.messages.map((m) =>
              m.id === aiMessageId
                ? { ...m, content: cleaned, toolCalls: mergedTcs }
                : m,
            ),
          }
        })
      }, DEBOUNCE_MS)
    })

    // 推理模型"思考过程"流式监听：把 reasoning_content 逐块累加到 reasoningContent
    const unlistenReasoning = window.api.agent.onReasoning((data) => {
      if (data.streamId !== streamId) return
      streamingReasoningBuffer += data.delta
      if (streamingReasoningDebounceTimer) return
      streamingReasoningDebounceTimer = setTimeout(() => {
        streamingReasoningDebounceTimer = null
        const raw = streamingReasoningBuffer
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === aiMessageId ? { ...m, reasoningContent: raw } : m,
          ),
        }))
      }, DEBOUNCE_MS)
    })

    // 注：以前有个 onContentReplace 兜底事件（后端 watchdog 检测到 tool_call 时会通知前端覆盖内容），
    // 现在改为前端 redactStreamingToolCalls 在 UI 层实时清洗，不再需要该事件。

    const unlistenToolStart = window.api.agent.onToolStart((data) => {
      if (data.streamId !== streamId) return
      const tc = data.toolCall as AgentToolCall
      const startedAt = Date.now()
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === aiMessageId
            ? { ...m, toolCalls: [...(m.toolCalls || []), { call: tc, result: { id: tc.id, name: tc.name, success: false, data: null }, startedAt }] }
            : m,
        ),
      }))
    })

    const unlistenToolEnd = window.api.agent.onToolEnd((data) => {
      if (data.streamId !== streamId) return
      const result = data.result as AgentToolResult
      const finishedAt = Date.now()
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                toolCalls: (m.toolCalls || []).map((tc) =>
                  tc.call.id === result.id ? { ...tc, result, finishedAt } : tc,
                ),
              }
            : m,
        ),
      }))
    })

    const unlistenPendingWrite = window.api.agent.onPendingWrite((data) => {
      if (data.streamId !== streamId) return
      const write = data.write as PendingWrite
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === aiMessageId
            ? { ...m, pendingWrites: [...(m.pendingWrites || []), write] }
            : m,
        ),
      }))
    })

    const unlistenDone = window.api.agent.onDone((data) => {
      if (data.streamId !== streamId) return
      const bufferedContent = streamingContentBuffer
      if (streamingDebounceTimer) {
        clearTimeout(streamingDebounceTimer)
        streamingDebounceTimer = null
      }
      streamingContentBuffer = ''
      // flush 推理模型"思考过程"缓冲，避免尾部片段丢失
      if (streamingReasoningDebounceTimer) {
        clearTimeout(streamingReasoningDebounceTimer)
        streamingReasoningDebounceTimer = null
      }
      const bufferedReasoning = streamingReasoningBuffer
      streamingReasoningBuffer = ''
      const merged = (() => {
        const buf = bufferedContent || ''
        const done = data.content || ''
        if (!done) return buf
        if (!buf) return done
        if (buf.endsWith(done) || buf.includes(done)) return buf
        return buf + (buf.endsWith('\n') ? '' : '\n\n') + done
      })()
      // 最终清洗：提取合并后内容中残留的 ```tool_call 块
      const { cleaned, blocks } = parseToolCallBlocks(merged)
      const finalContent = cleaned || merged
      set((state) => {
        const existingTcs = state.messages.find((m) => m.id === aiMessageId)?.toolCalls || []
        const existingKeys = new Set(existingTcs.map(tc => `${tc.call.name}:${JSON.stringify(tc.call.arguments)}`))
        const mergedTcs = [...existingTcs]
        for (const block of blocks) {
          const key = `${block.name}:${JSON.stringify(block.arguments)}`
          if (existingKeys.has(key)) continue
          existingKeys.add(key)
          const callId = `tc_${Date.now()}_${mergedTcs.length}`
          mergedTcs.push({
            call: { id: callId, name: block.name, arguments: block.arguments },
            result: { id: callId, name: block.name, success: false, data: null },
            startedAt: Date.now(),
          })
        }
        return {
          messages: state.messages.map((m) =>
            m.id === aiMessageId
              ? {
                  ...m,
                  content: finalContent,
                  streaming: false,
                  reasoningContent: bufferedReasoning || data.reasoning || m.reasoningContent,
                  usage: data.usage,
                  toolCalls: mergedTcs,
                  pendingWrites: data.pendingWrites || m.pendingWrites,
                  aborted: data.aborted,
                  // 模型调用失败：errorMessage 写入 message.error，UI 可读。
                  // 与 aborted 互斥：aborted=用户主动停止；errorMessage=模型端报错。
                  // 两者都走同一条 done 通道，token 统计 + contextSnapshot.rounds 都会保留。
                  errorMessage: data.errored ? (data.errorMessage || '模型调用失败') : undefined,
                  resumeAfterApply: data.resumeAfterApply,
                  contextSnapshot: data.contextSnapshot,
                }
              : m,
          ),
          activeRun: null,
          streamingMessageId: null,
        }
      })
      window.dispatchEvent(new Event('token-usage-updated'))
      // 清理监听
      unlistenChunk()
      unlistenReasoning()
      unlistenToolStart()
      unlistenToolEnd()
      unlistenPendingWrite()
      unlistenDone()
      unlistenError()
    })

    const unlistenError = window.api.agent.onError((data) => {
      if (data.streamId !== streamId) return
      if (streamingDebounceTimer) {
        clearTimeout(streamingDebounceTimer)
        streamingDebounceTimer = null
      }
      if (streamingReasoningDebounceTimer) {
        clearTimeout(streamingReasoningDebounceTimer)
        streamingReasoningDebounceTimer = null
      }
      const finalBuffered = streamingContentBuffer
      streamingContentBuffer = ''
      const finalReasoning = streamingReasoningBuffer
      streamingReasoningBuffer = ''
      const { cleaned } = parseToolCallBlocks(finalBuffered)
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === aiMessageId
            ? { ...m, content: cleaned || m.content || `${data.message}`, reasoningContent: finalReasoning || m.reasoningContent, streaming: false }
            : m,
        ),
        activeRun: null,
        streamingMessageId: null,
      }))
      unlistenChunk()
      unlistenReasoning()
      unlistenToolStart()
      unlistenToolEnd()
      unlistenPendingWrite()
      unlistenDone()
      unlistenError()
    })

    // 计算携带的历史聊天记录：取当前轮之前的内存线程，按设置条数截取（排除刚追加的当前 user + ai 占位）
    const historyLimit = getAiChatHistoryLimitSetting()
    const history: Array<{ role: 'user' | 'assistant'; content: string }> =
      historyLimit > 0
        ? get()
            .messages.slice(0, -2)
            .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
            .slice(-historyLimit)
            .map((m) => ({
              role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
              content: m.content,
            }))
        : []

    // 启动 Agent
    await window.api.agent.run({
      streamId,
      bookId: opts.bookId,
      modelId: opts.modelId,
      chapterId: opts.chapterId || null,
      volumeId: opts.volumeId || null,
      finalize: opts.finalize,
      userInput,
      history,
      outputLanguage: getAiOutputLanguageSetting(),
      contextDepth: getAiContextDepthSetting(),
      injectWritingSettings: getAiInjectWritingSettingsSetting(),
      styleFingerprintId: opts.styleFingerprintId,
      streamTimeout: getAiStreamTimeoutSetting(),
      appliedPendingWriteTypes: opts.appliedPendingWriteTypes,
      ...getAiWriteContextSettings(),
    })
  },

  stopRun: async () => {
    const run = get().activeRun
    if (!run) return
    if (streamingDebounceTimer) {
      clearTimeout(streamingDebounceTimer)
      streamingDebounceTimer = null
    }
    if (streamingReasoningDebounceTimer) {
      clearTimeout(streamingReasoningDebounceTimer)
      streamingReasoningDebounceTimer = null
    }
    // 停止前把缓冲的最后一段内容 flush 到 store，避免尾部字符丢失
    const finalBuffered = streamingContentBuffer
    streamingContentBuffer = ''
    const finalReasoning = streamingReasoningBuffer
    streamingReasoningBuffer = ''
    const { cleaned } = parseToolCallBlocks(finalBuffered)
    await window.api.agent.stop(run.streamId)
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === state.streamingMessageId
          ? { ...m, content: cleaned || m.content, reasoningContent: finalReasoning || m.reasoningContent, streaming: false, aborted: true }
          : m,
      ),
      activeRun: null,
      streamingMessageId: null,
    }))
  },

  applyWrite: async (messageId, writeId, modelId, modifiedData) => {
    const state = get()
    const message = state.messages.find((m) => m.id === messageId)
    if (!message?.pendingWrites) {
      console.error('[agent.store] applyWrite: message or pendingWrites not found', { messageId, foundMessage: !!message })
      return { success: false, message: '消息不存在' }
    }
    const write = message.pendingWrites.find((w) => w.id === writeId)
    if (!write) {
      console.error('[agent.store] applyWrite: write not found', { writeId, pendingWrites: message.pendingWrites?.map(w => w.id) })
      return { success: false, message: '操作不存在' }
    }
    if (write.applied) {
      console.warn('[agent.store] applyWrite: write already applied', { writeId })
      return { success: false, message: '该操作已被应用' }
    }

    // 如果传入了修改后的 data，合并到 write 中
    const writeToApply = modifiedData ? { ...write, data: { ...write.data, ...modifiedData } } : write

    const result = await window.api.agent.apply({ write: writeToApply, modelId }) as ApplyResult

    // 标记为已应用，同时更新 data（保留用户修改），并在聊天内容追加已应用提示
    const appliedLabel = WRITE_TYPE_LABELS[write.type] || write.type
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: m.content ? `${m.content}\n\n已应用${appliedLabel}结果` : `已应用${appliedLabel}结果`,
              pendingWrites: m.pendingWrites?.map((w) =>
                w.id === writeId ? { ...w, applied: true, data: writeToApply.data } : w,
              ),
            }
          : m,
      ),
    }))

    // 刷新书籍数据。
    // 创建了新书时，需要：
    //   1. **先**把当前桶（无书状态 = 'global'；有书状态 = 上一本书）的相关聊天迁移/复制到新书桶；
    //   2. **再**刷新书籍列表 + 切到新书。顺序不能颠倒！
    //
    // 严重 bug 教训（已修复）：
    //   之前的写法是先 `await loadBooks()` 再判断 prevBookId。但 loadBooks 有个副作用：
    //   如果之前 currentBookId 为空（无书状态），且列表刷新后 books.length > 0，
    //   它会**自动 setCurrentBook(books[0])**（即刚创建的新书）。这样：
    //     - prevBookId 从预期的 null 被"提前"变成 newBookId
    //     - `if (prevBookId !== result.createdId)` 判为 false → relocateChatOnBookCreate 分支被完全跳过
    //     - move('global' → newBookId) 从未执行
    //     - 与此同时 `useEffect([currentBook?.id])` 触发 loadMessages(newBookId) → 拿到空数组 → UI 清空
    //     - 数据其实还在 global 桶，但用户永远看不到（无书状态入口被有书状态屏蔽）
    //   ⇒ 表现为"新建书之后，Agent 的聊天信息全部消失"。
    //
    // 正确顺序：**在 loadBooks 之前**读取 prevBookId 并执行 relocate，让新书桶先落库好数据，
    // 之后 loadBooks 触发的隐式 setCurrentBook + useEffect(loadMessages) 读到的就是"已复制/迁移到新书桶"的完整历史。
    if (result?.createdId) {
      try {
        const prevBookId = useWorkspaceStore.getState().currentBook?.id || null
        if (prevBookId !== result.createdId) {
          await relocateChatOnBookCreate(prevBookId, result.createdId, messageId, get)
        }
      } catch (err) {
        console.warn('[agent.store] relocate chat history to new book failed', err)
      }
    }

    try {
      await useWorkspaceStore.getState().loadBooks()
      if (result?.createdId) {
        // 显式确保切到新书（若 loadBooks 已隐式切过则无副作用）
        await useWorkspaceStore.getState().setCurrentBook(result.createdId)
      }
    } catch {}

    // 按 write.type 扇出刷新（Outline / Volumes / Chapters / Editor / 设定页）
    try {
      await refreshAfterApply(writeToApply)
    } catch (err) {
      console.warn('[agent.store] refreshAfterApply failed', err)
    }

    window.dispatchEvent(new Event('token-usage-updated'))

    // 触发自动续跑判定（若本消息所有 PendingWrite 都已应用 + 模型标记过 resumeAfterApply）
    void maybeTriggerAutoResume(messageId, modelId, get, get().sendMessage)

    return result
  },

  applyAll: async (messageId, modelId) => {
    const message = get().messages.find((m) => m.id === messageId)
    if (!message?.pendingWrites) return

    const unapplied = message.pendingWrites.filter((w) => !w.applied)
    if (unapplied.length === 0) return

    const results = await window.api.agent.applyBatch({ writes: unapplied, modelId }) as Array<ApplyResult & { writeId: string }>

    // 标记所有为已应用，并在聊天内容追加已应用提示
    const labels = unapplied.map((w) => WRITE_TYPE_LABELS[w.type] || w.type)
    const appliedText = `已应用${labels.join('、')}结果`
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: m.content ? `${m.content}\n\n${appliedText}` : appliedText,
              pendingWrites: m.pendingWrites?.map((w) => ({ ...w, applied: true })),
            }
          : m,
      ),
    }))

    // 同 applyWrite：如果创建了新书，先把当前桶的相关聊天 relocate 到新书桶，再 loadBooks + 切到新书。
    // ⚠️ 顺序不能颠倒！loadBooks 会隐式切书导致 prevBookId 提前变成新书 id，relocate 就会被跳过。
    // 参见 applyWrite 里那段详细注释。
    const createdBook = results?.find((r: any) => r.createdId)
    if (createdBook?.createdId) {
      try {
        const prevBookId = useWorkspaceStore.getState().currentBook?.id || null
        if (prevBookId !== createdBook.createdId) {
          await relocateChatOnBookCreate(prevBookId, createdBook.createdId, messageId, get)
        }
      } catch (err) {
        console.warn('[agent.store] relocate chat history to new book failed', err)
      }
    }

    try {
      await useWorkspaceStore.getState().loadBooks()
      if (createdBook?.createdId) {
        await useWorkspaceStore.getState().setCurrentBook(createdBook.createdId)
      }
    } catch {}

    // 遍历所有已应用的 write，按 type 扇出刷新（不阻塞返回结果）
    for (const w of unapplied) {
      try {
        await refreshAfterApply(w)
      } catch (err) {
        console.warn('[agent.store] refreshAfterApply failed', err)
      }
    }

    // 触发自动续跑判定
    void maybeTriggerAutoResume(messageId, modelId, get, get().sendMessage)

    return results
  },

  discardWrite: (messageId, writeId) => {
    // 放弃 = 从数组彻底移除（不留 discarded 状态位），语义最简单
    // 注意：放弃动作本身不通知模型，也不触发自动续跑；只有 apply 动作可能触发续跑。
    // 若"应用一张 + 放弃一张"，最后那次 apply 会带 modelId，届时判定通过就够了。
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, pendingWrites: (m.pendingWrites || []).filter((w) => w.id !== writeId) }
          : m,
      ),
    }))
  },

  rerunWrite: async (messageId, writeId, reason) => {
    const state = get()
    const message = state.messages.find((m) => m.id === messageId)
    if (!message) return
    const write = (message.pendingWrites || []).find((w) => w.id === writeId)
    if (!write) return

    // 1. 从消息里移除该卡片（旧卡不再展示）
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, pendingWrites: (m.pendingWrites || []).filter((w) => w.id !== writeId) }
          : m,
      ),
    }))

    // 2. 以用户身份发一条"重跑原因"消息，触发新 run
    const resolvedBookId = state.activeRun?.bookId ?? useWorkspaceStore.getState().currentBookId ?? null
    // modelId 可能挂在本消息上（assistant 消息），也可能挂在前一条 user 消息上——
    // 两种都兜底。回退到 localStorage 选中的模型。
    let modelId = message.modelId || ''
    if (!modelId) {
      // 找本消息之前最近一条带 modelId 的 user 消息
      const idx = state.messages.findIndex((m) => m.id === messageId)
      for (let i = idx - 1; i >= 0; i--) {
        const prev = state.messages[i]
        if (prev.modelId) { modelId = prev.modelId; break }
      }
    }
    if (!modelId) {
      try { modelId = localStorage.getItem('agent:selectedModelId') || '' } catch {}
    }
    if (!resolvedBookId || !modelId) {
      console.warn('[agent.store] rerunWrite: bookId or modelId missing', { resolvedBookId, modelId })
      return
    }
    const trimmedReason = (reason || '').trim() || '（用户未填写原因）'
    const userInput = `请按以下原因重新调用 request_user_confirmation 工具生成新的待确认内容：\n\n${trimmedReason}\n\n（请重新组织数据并再次调用 request_user_confirmation，原卡片已被移除。）`
    await get().sendMessage({
      bookId: resolvedBookId,
      modelId,
      userInput,
      displayInput: `重跑：${trimmedReason}`,
    })
  },

  rejectWrite: async (messageId, writeId, reason) => {
    const state = get()
    const message = state.messages.find((m) => m.id === messageId)
    if (!message) return
    const write = (message.pendingWrites || []).find((w) => w.id === writeId)
    if (!write) return

    const trimmedReason = (reason || '').trim() || '（用户未填写原因）'

    // 1. 标记卡片为 rejected（前端展示"已拒绝：原因"）
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              pendingWrites: (m.pendingWrites || []).map((w) =>
                w.id === writeId ? { ...w, rejected: true, rejectReason: trimmedReason } : w,
              ),
            }
          : m,
      ),
    }))

    // 2. 以用户身份发一条"用户已拒绝"消息，模型据此停止整条链路
    const resolvedBookId = state.activeRun?.bookId ?? useWorkspaceStore.getState().currentBookId ?? null
    // modelId 兜底逻辑：assistant 消息本身可能没写 modelId，往前找最近一条带 modelId 的 user 消息
    let modelId = message.modelId || ''
    if (!modelId) {
      const idx = state.messages.findIndex((m) => m.id === messageId)
      for (let i = idx - 1; i >= 0; i--) {
        const prev = state.messages[i]
        if (prev.modelId) { modelId = prev.modelId; break }
      }
    }
    if (!modelId) {
      try { modelId = localStorage.getItem('agent:selectedModelId') || '' } catch {}
    }
    if (!resolvedBookId || !modelId) {
      console.warn('[agent.store] rejectWrite: bookId or modelId missing', { resolvedBookId, modelId })
      return
    }
    const userInput = `用户已拒绝卡片「${write.title}」，原因：${trimmedReason}\n\n请停止整条链路，不要再调用任何工具，直接输出一句简短的"已停止"确认即可。`
    await get().sendMessage({
      bookId: resolvedBookId,
      modelId,
      userInput,
      displayInput: `已拒绝「${write.title}」：${trimmedReason}`,
    })
  },

  clearMessages: async () => {
    // 清空所有 bookId（包括 global）下的消息
    try {
      await window.api.chatMessage.clearAll()
    } catch (err) {
      console.error('[agent.store] clearMessages (clearAll) failed', err)
    }
    set({ messages: [], activeRun: null, streamingMessageId: null })
  },

  setMessages: (messages) => {
    set({ messages })
  },

  loadMessages: async (bookId) => {
    const bookKey = bookId || 'global'
    try {
      const dbMessages = await window.api.chatMessage.list(bookKey)
      const converted = (dbMessages || []).map((msg: any) => ({
        id: msg.id,
        role: msg.role === 'ai' ? 'assistant' as const : msg.role as 'user' | 'assistant',
        content: msg.content || '',
        streaming: false,
        toolCalls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
        pendingWrites: msg.pendingWrites ? JSON.parse(msg.pendingWrites) : undefined,
        usage: msg.usage,
        aborted: msg.aborted || false,
        resumeAfterApply: msg.resumeAfterApply || false,
        autoResumed: msg.autoResumed || false,
        contextSnapshot: msg.contextSnapshot,
        createdAt: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
      }))
      // 完全替换当前 messages，避免在数据为空时保留旧数据
      set({ messages: converted })
    } catch (err) {
      console.error('[agent.store] loadMessages failed', err)
    }
  },

  saveMessages: async (bookId) => {
    const bookKey = bookId || 'global'
    const messages = get().messages
    try {
      const saveData = messages.map((msg) => ({
        id: msg.id,
        role: (msg.role === 'assistant' ? 'ai' : 'user') as 'user' | 'ai',
        content: msg.content,
        usage: msg.usage,
        contextSnapshot: msg.contextSnapshot,
        aborted: msg.aborted,
        resumeAfterApply: msg.resumeAfterApply,
        autoResumed: msg.autoResumed,
        toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        pendingWrites: msg.pendingWrites ? JSON.stringify(msg.pendingWrites) : null,
      }))
      await window.api.chatMessage.saveBatch({ bookId: bookKey, messages: saveData })
    } catch (err) {
      console.error('[agent.store] saveMessages failed', err)
    }
  },

  updateStreamingContent: (messageId, content) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m,
      ),
    }))
  },
}))
