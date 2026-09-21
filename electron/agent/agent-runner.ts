/**
 * Agent 循环执行器
 *
 * 核心循环：
 * 1. 构建初始 messages（system + history + user）
 * 2. 调用模型（原生 function calling 或 JSON 降级）
 * 3. 解析响应：有 tool_calls → 执行工具 → 回注结果 → 继续循环
 * 4. 无 tool_calls → 最终回复 → 结束
 *
 * 最大循环 15 次防止无限调用
 */

import { runAgentModel, parseNativeToolCalls, type AgentModelPayload } from './model-caller'
import { buildStaticSystemMessage, toOpenAITools, buildMinimalSystemMessage, buildIntentionAnalyzerPrompt, buildToolCatalogPrompt, buildNextStepToolPrompts } from './prompt-builder'
import { executeToolCalls } from './tool-executor'
import { getMemoryText, buildSemiStaticContext, loadChapterMemoryByOrder, buildWriteContextParts } from './memory'
import { serializeChapterMemory } from './memory/serializer'
import type { AgentRunConfig, AgentRunResult, AgentMessage, ToolCall, ToolResult, PendingWrite, ToolContext } from './types'
import { listToolDefinitions, getTool, getExcludedContexts } from './tools'
import { getToolPrompt } from './tools/tool-prompts'
import { resolveSamplingParams } from '../utils/sampling'
import { getDb } from '../db'
import { books, volumes, chapters, outlines, bookSettingEntries } from '../db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getWritingStyleSummary } from './style'

/**
 * 意图分析输出的「目标引用」：由 LLM 把用户输入归一成数字序号。
 * 这是章节/分卷解析的唯一来源——绝不在代码里用正则去解析用户输入文本。
 */
interface IntentTarget {
  kind: 'chapter' | 'volume' | 'book' | 'none'
  chapterOrder: number | null // 1-based 人类序号
  volumeOrder: number | null // 1-based 人类序号
  relation: 'next' | 'prev' | 'current' | 'none'
}

const EMPTY_TARGET: IntentTarget = { kind: 'none', chapterOrder: null, volumeOrder: null, relation: 'none' }

const CHINESE_TOOL_NAME_MAP: Record<string, string> = {
  // 书籍
  '书籍列表': 'list_books',
  '查看书籍列表': 'list_books',
  '查看书籍': 'get_book',
  '创建书籍': 'create_book',
  '编辑书籍': 'update_book',
  // 分卷
  '分卷列表': 'list_volumes',
  '查看分卷列表': 'list_volumes',
  '查看分卷': 'get_volume',
  '创建分卷': 'create_volumes',
  '编辑分卷': 'update_volume',
  '编辑分卷大纲': 'update_volume_outline',
  // 章节
  '章节列表': 'list_chapters',
  '查看章节列表': 'list_chapters',
  '查看章节': 'get_chapter',
  '查看正文': 'get_chapter_content',
  '创建章节': 'create_chapters',
  '编辑章节': 'update_chapter',
  '写作正文': 'write_chapter_content',
  '编辑章节大纲': 'update_chapter_outline',
  // 大纲
  '查看全书大纲': 'get_book_outline',
  '编辑全书大纲': 'write_book_outline',
  // 设定
  '设定列表': 'list_settings',
  '查看设定': 'list_settings',
  '查看设定条目': 'get_setting',
  '创建设定': 'create_settings',
  '编辑设定条目': 'update_setting',
  // 记忆
  '记忆列表': 'list_snapshots',
  '查看记忆列表': 'list_snapshots',
  '查看章节记忆': 'get_snapshot',
  '生成章节记忆': 'generate_snapshot',
  // 系统
  '删除': 'delete_entity',
}

/** 工具名称 → 中文映射（用于渲染「第 N 轮 · 调用xx」轮次标签，须与工具集页/对话展示一致） */
const TOOL_NAME_CN: Record<string, string> = {
  list_books: '书籍列表',
  get_book: '查看书籍',
  create_book: '创建书籍',
  update_book: '更新书籍',
  list_volumes: '分卷列表',
  create_volumes: '创建分卷',
  update_volume: '更新分卷',
  update_volume_outline: '更新分卷大纲',
  list_chapters: '章节列表',
  get_chapter: '查看章节',
  get_chapter_content: '获取章节正文',
  create_chapters: '创建章节',
  update_chapter: '更新章节',
  write_chapter_content: '写章节正文',
  update_chapter_outline: '更新章节大纲',
  get_book_outline: '获取书籍大纲',
  write_book_outline: '写书籍大纲',
  list_settings: '设定列表',
  get_setting: '查看设定条目',
  create_settings: '创建设定',
  update_setting: '更新设定条目',
  delete_entity: '删除对象',
  get_snapshot: '获取记忆',
  list_snapshots: '记忆列表',
  generate_snapshot: '生成记忆',
  get_memory: '获取总记忆',
  get_chapter_memory: '获取章节记忆',
  get_writing_context: '获取写作上下文',
  mark_resume_after_apply: '标记续跑',
}

/** write_chapter_content 调用后需要补充注入的上下文（由知卷设置控制） */

/** 最大循环次数 */
const MAX_ITERATIONS = 15

/**
 * 从模型 content 中解析"文本形式的工具调用"（原生 FC 降级模式使用）。
 *
 * 兼容以下所有常见输出格式，尽可能宽容地解析出 { id, name, arguments }：
 *  1. ```tool_call ... ``` 代码块（本项目 prompt 指定的规范格式）
 *  2. <tool_call> ... </tool_call> XML 标签（Qwen / Yi / Mistral 常见）
 *  3. ```json ... ``` / ``` ... ``` 无 lang 代码块，里面是包含 name 字段的对象或数组
 *  4. content 里直接裸露的 JSON 对象/数组（末尾没有代码块包裹）
 *
 * 对每一条 tool_call 还兼容以下变体：
 *  - 顶层是单对象而不是数组
 *  - `arguments` 是 JSON 字符串（`"arguments":"{\"a\":1}"`）——自动解一次
 *  - 用 `tool` / `function` / `tool_name` 等别名替代 `name`
 *  - 用 `parameters` / `args` / `input` 替代 `arguments`
 *
 * 会尽力从 content 中把已识别的调用块从 remainingText 里剥离掉，
 * 保证"最终回复文本"不会重复包含 JSON 调用 raw 文本。
 */
function parseJsonToolCalls(content: string): { toolCalls: ToolCall[]; remainingText: string } {
  const toolCalls: ToolCall[] = []
  let remainingText = content || ''

  /**
   * 从字符串开头扫描出一个"完整平衡"的 JSON 值（对象或数组），返回该 JSON 子串；
   * 如果字符串开头既不是 { 也不是 [ 或不能形成平衡，返回 null。
   * 用于兜底：模型输出 JSON 后面跟了解释性文本时，能精确切出 JSON 部分。
   */
  const extractLeadingJson = (str: string): string | null => {
    const s = str.trimStart()
    const first = s[0]
    if (first !== '{' && first !== '[') return null
    let depth = 0
    let inString = false
    let escapeNext = false
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (escapeNext) { escapeNext = false; continue }
      if (ch === '\\' && inString) { escapeNext = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return s.slice(0, i + 1)
      }
    }
    return null
  }

  /** 把任意 JS 值规范化成一条 ToolCall；无法识别时返回 null
   *
   * 兼容以下几种 shape：
   *   - { name: "xxx", arguments: {...} }                    （最常见）
   *   - { tool: "xxx", args: {...} }                          （变体）
   *   - { function: "xxx", arguments: "..." }                （function 是字符串时）
   *   - { function: { name, arguments } }                     （OpenAI 原生 tool_call 结构：function 是对象）
   *   - { function_call: { name, arguments } }                （旧 OpenAI 结构）
   */
  const normalize = (item: any): ToolCall | null => {
    if (!item || typeof item !== 'object') return null
    const fn = item.function
    // 关键修复：item.function 既可能是字符串（工具名），也可能是对象（含 name/arguments），需要分别处理。
    // 之前的实现 `item.function` 会把对象当成 name 传下去，被 `typeof name !== 'string'` 判为无效，
    // 整条 tool_call 静默丢失。
    const name = item.name
      || item.tool
      || item.tool_name
      || (typeof fn === 'string' ? fn : (fn && fn.name))
      || (item.function_call && item.function_call.name)
    if (!name || typeof name !== 'string') return null
    let args: any = item.arguments
      ?? item.parameters
      ?? item.args
      ?? item.input
      ?? (fn && typeof fn === 'object' && fn.arguments)
      ?? (item.function_call && item.function_call.arguments)
    if (typeof args === 'string') {
      // arguments 是 JSON 字符串（OpenAI 兼容格式），尝试解一次
      const s = args.trim()
      if (s.startsWith('{') || s.startsWith('[')) {
        try { args = JSON.parse(s) } catch { /* 解析失败保留字符串，交由下面 _raw 兜底 */ }
      }
    }
    // 如果 args 仍然不是对象/数组（非 JSON 字符串或其它值），保留原文到 _raw 让工具层看到原始参数，
    // 避免"参数字符串被静默清空为 {}"这种难排查的问题。
    if (args == null) {
      args = {}
    } else if (typeof args !== 'object') {
      args = { _raw: String(args) }
    }
    return {
      id: item.id || item.tool_call_id || `call_${uuidv4().slice(0, 8)}`,
      name,
      arguments: args,
    }
  }

  /** 从任意 JSON 解析结果（可能是数组、对象、或包含 tool_calls 数组的对象）中提取 tool_calls */
  const collect = (parsed: any) => {
    if (!parsed) return
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const call = normalize(item)
        if (call) toolCalls.push(call)
      }
      return
    }
    if (typeof parsed === 'object') {
      // 形如 { tool_calls: [...] } 的包装
      if (Array.isArray(parsed.tool_calls)) {
        for (const item of parsed.tool_calls) {
          const call = normalize(item)
          if (call) toolCalls.push(call)
        }
        return
      }
      // 单对象直接就是一条 tool call
      const call = normalize(parsed)
      if (call) toolCalls.push(call)
    }
  }

  // ---- 1) ```tool_call``` 代码块 ----
  // 优先匹配带闭合的 ```tool_call ... ```；若模型没输出闭合 fence（截断/流式中断），
  // 用第二个正则兜底：```tool_call 之后一直到内容末尾（贪婪吃到最后一个可能的 ``` 或字符串结尾）。
  const toolCallBlock = /```tool_call\s*\n?([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = toolCallBlock.exec(content)) !== null) {
    const body = m[1].trim()
    try {
      collect(JSON.parse(body))
    } catch {
      let cursor = body
      let salvaged = 0
      while (cursor.length > 0) {
        cursor = cursor.replace(/^[\s,;]+/, '')
        if (!cursor) break
        const piece = extractLeadingJson(cursor)
        if (!piece) break
        try {
          collect(JSON.parse(piece))
          salvaged += 1
        } catch { /* 单块 parse 失败就跳过它，继续尝试后续 */ }
        cursor = cursor.slice(piece.length)
      }
    }
    remainingText = remainingText.replace(m[0], '')
  }
  // 兜底：```tool_call 未闭合的情况（例如模型 max_tokens 截断），把从 ```tool_call 到末尾的内容作为 JSON 尝试
  if (toolCalls.length === 0) {
    const openOnly = /```tool_call\s*\n?([\s\S]+)$/i.exec(content)
    if (openOnly) {
      let body = openOnly[1].trim()
      // 去掉末尾可能残留的 ```
      body = body.replace(/```\s*$/, '').trim()
      // 尝试用括号栈扫描找到合法的 JSON 边界（防止后面跟了非 JSON 文本）
      const scanned = extractLeadingJson(body)
      if (scanned) {
        try { collect(JSON.parse(scanned)) } catch { }
      } else {
        try { collect(JSON.parse(body)) } catch { }
      }
      if (toolCalls.length > 0) {
        remainingText = remainingText.replace(openOnly[0], '')
      }
    }
  }

  // ---- 2) <tool_call>...</tool_call> XML 标签 ----
  const xmlBlock = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  while ((m = xmlBlock.exec(content)) !== null) {
    try { collect(JSON.parse(m[1].trim())) } catch { }
    remainingText = remainingText.replace(m[0], '')
  }

  // ---- 3) ```json / ``` 通用代码块中含 "name":"xxx" 或 "tool_calls" ----
  if (toolCalls.length === 0) {
    const genericBlock = /```(?:json)?\s*\n?([\s\S]*?)```/gi
    while ((m = genericBlock.exec(content)) !== null) {
      const body = m[1].trim()
      // 快速过滤：不含 name/tool_calls 字段的普通 JSON 直接跳过
      if (!/"(name|tool|tool_name|tool_calls|function)"\s*:/.test(body)) continue
      try { collect(JSON.parse(body)) } catch { }
      remainingText = remainingText.replace(m[0], '')
    }
  }

  // 剥离 remainingText 中残留的 ```json ... ``` 代码块（非工具调用的纯 JSON 数据，不应展示给用户）
  remainingText = remainingText.replace(/```json\s*\n?([\s\S]*?)```\s*\n?/gi, '')

  // ---- 4) 裸露的 JSON 数组/对象（模型直接吐 JSON、无任何包裹）----
  // 只有在前几种都没解析到时才做，避免把最终回复正文里合法的 JSON 引用当成调用。
  if (toolCalls.length === 0) {
    const stripped = remainingText.trim()
    if ((stripped.startsWith('{') && stripped.endsWith('}')) || (stripped.startsWith('[') && stripped.endsWith(']'))) {
      if (/"(name|tool|tool_name|tool_calls|function)"\s*:/.test(stripped)) {
        try {
          collect(JSON.parse(stripped))
          if (toolCalls.length > 0) remainingText = ''
        } catch { }
      }
    }
  }

  // ---- 5) 贪心兜底：扫描 remainingText 里第一段合法的 JSON（前后可能夹带文本、markdown 标记等） ----
  // 覆盖两种典型场景：
  //   a) 模型输出："我将调用工具：[{...}]" 混合文本
  //   b) 代码围栏格式不标准（例如 4 反引号、只有开头没有闭合等），前面的正则都失效
  if (toolCalls.length === 0) {
    const startPatterns = [
      /\[\s*\{\s*"(?:name|tool|tool_name|tool_calls|function|id)"/,
      /\{\s*"(?:tool_calls|name|tool|tool_name|function|function_call)"/,
    ]
    for (const p of startPatterns) {
      const idx = remainingText.search(p)
      if (idx < 0) continue
      const candidate = extractLeadingJson(remainingText.slice(idx))
      if (!candidate) continue
      try {
        collect(JSON.parse(candidate))
        if (toolCalls.length > 0) {
          remainingText = (remainingText.slice(0, idx) + remainingText.slice(idx + candidate.length)).trim()
          break
        }
      } catch { }
    }
  }

  // ---- 6) 中文工具名 + 裸 JSON 格式（模型输出：第一行中文工具名，第二行开始是 JSON）----
  // 例如：
  //   创建分卷
  //   {"volumes": [...]}
  if (toolCalls.length === 0) {
    const lines = remainingText.split('\n')
    if (lines.length >= 2) {
      const firstLine = lines[0].trim()
      const englishToolName = CHINESE_TOOL_NAME_MAP[firstLine]
      if (englishToolName) {
        const rest = lines.slice(1).join('\n').trim()
        if (rest.startsWith('{') || rest.startsWith('[')) {
          try {
            const args = JSON.parse(rest)
            toolCalls.push({
              id: `call_${uuidv4().slice(0, 8)}`,
              name: englishToolName,
              arguments: args,
            })
            remainingText = ''
          } catch { }
        }
      }
    }
  }

  // ---- 7) 已知英文工具名 + 混合文本中的 JSON 片段（兜底）----
  // 模型在自然语言中混入工具名和 JSON，例如：
  //   create_chapters with chapters is [{"title":"第一章",...}] is is_prerequisite is false
  // 本层扫描所有已注册工具名，找到后尝试提取紧随的 JSON
  if (toolCalls.length === 0) {
    const knownToolNames = new Set(Object.values(CHINESE_TOOL_NAME_MAP))
    // 哪些 write 工具的"唯一数组参数"对应的 key 名
    const arrayArgKey: Record<string, string> = {
      'create_chapters': 'chapters',
      'create_volumes': 'volumes',
      'create_settings': 'settings',
    }
    for (const toolName of knownToolNames) {
      const idx = remainingText.indexOf(toolName)
      if (idx < 0) continue
      // 工具名之后的内容
      const after = remainingText.slice(idx + toolName.length)
      // 找到第一个 JSON 起始符 [ 或 {
      const jsonStart = after.search(/[\[{]/)
      if (jsonStart < 0) continue
      const candidate = extractLeadingJson(after.slice(jsonStart))
      if (!candidate) continue
      try {
        const parsed = JSON.parse(candidate)
        let argumentsObj: Record<string, any>
        if (Array.isArray(parsed)) {
          // 直接是数组 → 按工具的数组参数名包裹
          const key = arrayArgKey[toolName]
          argumentsObj = key ? { [key]: parsed } : { items: parsed }
        } else if (typeof parsed === 'object') {
          // 是对象 → 检查是否已经包含正确的参数名
          const expectedKey = arrayArgKey[toolName]
          if (expectedKey && parsed[expectedKey] !== undefined) {
            // 已经是正确格式 { chapters: [...] }
            argumentsObj = parsed
          } else if (expectedKey && (parsed.title !== undefined || parsed.name !== undefined)) {
            // 看起来像单个条目 → 包裹为数组
            argumentsObj = { [expectedKey]: [parsed] }
          } else {
            // 直接作为 arguments
            argumentsObj = parsed
          }
        } else {
          continue
        }
        toolCalls.push({
          id: `call_${uuidv4().slice(0, 8)}`,
          name: toolName,
          arguments: argumentsObj,
        })
        remainingText = (remainingText.slice(0, idx) + remainingText.slice(idx + toolName.length + jsonStart + candidate.length)).trim()
        break // 只提取第一个匹配的工具调用，防止误伤
      } catch { /* 继续尝试其他工具名 */ }
    }
  }

  // ---- 8) 自然语言 K=V 模板（write_chapter_content 等长文本工具兜底）----
  // 某些弱模型写正文时无法输出 JSON，退化为自然语言：
  //   write_chapter_content with chapterId is uuid content is 正文...
  // 本层用已知参数名 + "is" 分隔符提取 K=V 对
  if (toolCalls.length === 0) {
    const toolParamKeys: Record<string, string[]> = {
      'write_chapter_content': ['chapterId', 'content'],
      'write_book_outline': ['outline'],
      'update_chapter_outline': ['chapterId', 'outline'],
      'update_volume_outline': ['volumeId', 'outline'],
    }
    const knownToolNames = new Set(Object.values(CHINESE_TOOL_NAME_MAP))
    for (const toolName of knownToolNames) {
      const idx = remainingText.indexOf(toolName)
      if (idx < 0) continue
      const after = remainingText.slice(idx + toolName.length).trim()
      const paramKeys = toolParamKeys[toolName]
      if (!paramKeys || paramKeys.length === 0) continue

      // 去掉前导的 "with " 或 "："
      const body = after.replace(/^(with|：|:)\s*/, '')

      const args: Record<string, string> = {}
      const fragments: Array<{ key: string; start: number }> = []
      for (const key of paramKeys) {
        const pattern = new RegExp(`\\b${escapeRegex(key)}\\s+is\\s+`, 'i')
        const m = body.match(pattern)
        if (m && m.index !== undefined) {
          fragments.push({ key, start: m.index! + m[0].length })
        }
      }
      // 按出现位置排序
      fragments.sort((a, b) => a.start - b.start)
      if (fragments.length === 0) continue

      for (let i = 0; i < fragments.length; i++) {
        const end = i + 1 < fragments.length ? fragments[i + 1].start : body.length
        args[fragments[i].key] = body.slice(fragments[i].start, end).trim()
      }

      // 必须至少解析出一个非空参数
      const filledKeys = Object.keys(args).filter(k => args[k].length > 0)
      if (filledKeys.length === 0) continue

      // 对 content 字段做兜底：literal \n → 真换行（如果��文没有真换行）
      if (args.content) {
        if (!/\n/.test(args.content) && /\\n/.test(args.content)) {
          args.content = args.content.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        }
      }

      toolCalls.push({
        id: `call_${uuidv4().slice(0, 8)}`,
        name: toolName,
        arguments: args,
      })
      remainingText = remainingText.slice(0, idx).trim()
      break
    }
  }

  return { toolCalls, remainingText: remainingText.trim() }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 计算写工具的去重键。
 * 同一 run 内，相同去重键的写工具调用会被拦截，防止重复产出 pendingWrite。
 * 返回 null 表示该工具不是写工具或不需要去重。
 */
function getWriteDedupKey(toolName: string, args: Record<string, any>, bookId?: string | null): string | null {
  const WRITE_TOOLS_GLOBAL_ONCE = ['write_chapter_content']
  const WRITE_TOOLS_WITH_CHAPTER = ['update_chapter_outline']
  const WRITE_TOOLS_WITH_VOLUME = ['update_volume_outline']
  const WRITE_TOOLS_WITH_BOOK = ['write_book_outline', 'create_volumes', 'create_chapters', 'create_settings']

  // 全局单次限制：这些写工具无论参数如何，同一 run 内只能调用一次
  if (WRITE_TOOLS_GLOBAL_ONCE.includes(toolName)) {
    return `${toolName}:_global_`
  }

  if (WRITE_TOOLS_WITH_CHAPTER.includes(toolName) && args.chapterId) {
    return `${toolName}:${args.chapterId}`
  }
  if (WRITE_TOOLS_WITH_VOLUME.includes(toolName) && args.volumeId) {
    return `${toolName}:${args.volumeId}`
  }
  if (WRITE_TOOLS_WITH_BOOK.includes(toolName) && bookId) {
    return `${toolName}:${bookId}`
  }
  return null
}

/** 运行 Agent */
export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const allPendingWrites: PendingWrite[] = []
  const toolCallHistory: Array<{ call: ToolCall; result: ToolResult }> = []
  // 追踪已调用的写工具目标，防止同一 run 内重复调用（如 write_chapter_content 同一 chapterId 调两次）
  const calledWriteTargets = new Set<string>()
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalCachedPromptTokens: number | undefined
  let totalReasoningTokens: number | undefined
  let totalCost = 0
  let finalContent = ''
  let aborted = false
  // 模型调用失败的错误消息：与 aborted 互斥；非空时表示在主循环里模型返回错误（content_filter / 截断 / 网络等），
  // 保留本轮 entry 推入执行链后 break，不再抛错出去（避免 UI 丢失 token 统计和执行链）。
  let modelRunError: string | null = null
  // 累计每轮模型返回的整段推理文本（result.reasoning）。流式推理已由 onReasoning 实时转发到前端，
  // 但部分推理模型/provider 只在最终响应（非流式 delta）返回 reasoning，此时流式不触发、
  // 必须靠这里聚合后在 done 兜底写入 message.reasoningContent，否则「思考过程」块为空。
  let accumulatedReasoning = ''

  // 检测是否支持原生 function calling
  let useNativeFunctionCalling = true
  let jsonFallbackTried = false

  // 收集每一轮实际发给模型的 messages 快照（深拷贝，防止后续修改污染）
  const rounds: Array<{
    label: string
    input: Array<{ role: string; content: string }>
    output?: Array<{ role: string; content: string }>
    usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; reasoningTokens?: number }
    durationMs?: number
    finishReason?: string | null
  }> = []

  // ========== 阶段一：意图分析 ==========
  // 用极简提示词判断用户意图是聊天还是需要调用工具
  // 这比关键词匹配更准确，且只消耗极少 tokens
  let isChatIntent = false
  let contextNeeds: {
    bookList?: boolean
    bookInfo?: boolean
    bookOutline?: boolean
    volumeList?: boolean
    volumeOutline?: boolean
    chapterList?: boolean
    chapterOutline?: boolean
    prevChapterOutline?: boolean
    nextChapterOutline?: boolean
    chapterMemory?: boolean
    settingList?: boolean
    memory?: boolean
  } = {}
  let predictedTools: string[] = []
  let intentTarget: IntentTarget = EMPTY_TARGET

  try {
    const intentionPrompt = buildIntentionAnalyzerPrompt()
    const intentionMessages: AgentMessage[] = [
      { role: 'system', content: intentionPrompt },
      { role: 'user', content: config.userInput },
    ]

    const intentionPayload: AgentModelPayload = {
      baseUrl: config.modelConfig.baseUrl,
      apiKey: config.modelConfig.apiKey,
      modelName: config.modelConfig.modelName,
      messages: intentionMessages,
      // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 意图分析内置默认 0.7
      ...resolveSamplingParams(config.modelConfig, 'agentIntention'),
      stream: true,
      mergeSystemMessages: config.modelConfig.mergeSystemMessages,
    }

    const intentionStartAt = Date.now()
    const intentionResult = await runAgentModel(intentionPayload, { signal: config.signal, onReasoning: config.onReasoning })
    const intentionDurationMs = Date.now() - intentionStartAt

    // 记录阶段一实际发送的 messages 快照，并包含模型的输出
    const intentionCached = intentionResult.usage?.prompt_tokens_details?.cached_tokens
      ?? intentionResult.usage?.prompt_cache_hit_tokens
      ?? intentionResult.usage?.cache_read_input_tokens
    const intentionReasoning = intentionResult.usage?.completion_tokens_details?.reasoning_tokens
    rounds.push({
      label: `第 1 轮 · 意图分析`,
      input: intentionMessages.map((m) => ({ role: m.role, content: m.content })),
      output: [{ role: 'assistant', content: intentionResult.content }],
      usage: {
        promptTokens: intentionResult.usage?.prompt_tokens || 0,
        completionTokens: intentionResult.usage?.completion_tokens || 0,
        ...(intentionCached !== undefined && intentionCached !== null ? { cachedTokens: Number(intentionCached) } : {}),
        ...(intentionReasoning !== undefined && intentionReasoning !== null ? { reasoningTokens: Number(intentionReasoning) } : {}),
      },
      durationMs: intentionDurationMs,
    })

    // 累加 tokens（意图分析也消耗 tokens）
    totalPromptTokens += intentionResult.usage?.prompt_tokens || 0
    totalCompletionTokens += intentionResult.usage?.completion_tokens || 0
    // 阶段一 cached_tokens 兼容多种 provider 字段：xAI/OpenAI 用 prompt_tokens_details.cached_tokens
    // DeepSeek 用 prompt_cache_hit_tokens；Anthropic 用 cache_read_input_tokens
    const intentionCachedAcc = intentionResult.usage?.prompt_tokens_details?.cached_tokens
      ?? intentionResult.usage?.prompt_cache_hit_tokens
      ?? intentionResult.usage?.cache_read_input_tokens
      ?? intentionResult.usage?.cached_tokens
    if (intentionCachedAcc !== undefined && intentionCachedAcc !== null) {
      totalCachedPromptTokens = (totalCachedPromptTokens || 0) + Number(intentionCachedAcc)
    }
    // 阶段一 reasoning_tokens（推理模型思考消耗）
    const intentionReasoningAcc = intentionResult.usage?.completion_tokens_details?.reasoning_tokens
    if (intentionReasoningAcc !== undefined && intentionReasoningAcc !== null) {
      totalReasoningTokens = (totalReasoningTokens || 0) + Number(intentionReasoningAcc)
    }

    // 解析意图分析结果
    try {
      const intentionJson = JSON.parse(intentionResult.content)
      isChatIntent = intentionJson.intent === 'chat'
      contextNeeds = intentionJson.contextNeeds || {}
      predictedTools = Array.isArray(intentionJson.predictedTools) ? intentionJson.predictedTools : []
      const rawTarget = intentionJson.target
      if (rawTarget && typeof rawTarget === 'object') {
        intentTarget = {
          kind: rawTarget.kind === 'volume' || rawTarget.kind === 'book' || rawTarget.kind === 'chapter' ? rawTarget.kind : 'none',
          chapterOrder: typeof rawTarget.chapterOrder === 'number' ? rawTarget.chapterOrder : null,
          volumeOrder: typeof rawTarget.volumeOrder === 'number' ? rawTarget.volumeOrder : null,
          relation: rawTarget.relation === 'next' || rawTarget.relation === 'prev' || rawTarget.relation === 'current' ? rawTarget.relation : 'none',
        }
      }
    } catch {
      isChatIntent = false
    }
  } catch (err) {
    isChatIntent = false
  }

  // 定稿流程：放弃确定性短路，改走聊天流。
  // 通过隐藏的系统提示告知模型必须调用 generate_snapshot（对用户不可见），
  // 并强制走写作流（注入工具目录 + 章节上下文），保证模型能正确调用工具，
  // 且本次模型调用与工具内部子调用的 token 都被正常累计、费用被正确统计。
  if (config.finalize && config.chapterId) {
    isChatIntent = false
    if (!predictedTools.includes('generate_snapshot')) predictedTools.push('generate_snapshot')
    // 定稿只生成记忆，不应触发正文改写工具
    predictedTools = predictedTools.filter((t) => t !== 'write_chapter_content')
  }

  // 保存意图分析阶段的完整消息（用于上下文快照展示）
  const intentionMessages: AgentMessage[] = [
    { role: 'system', content: buildIntentionAnalyzerPrompt() },
    { role: 'user', content: config.userInput },
  ]

  // ========== 阶段一.5：根据意图分析结果预加载上下文数据 ==========
  // 提前查询所需的上下文数据，注入到 system 消息中，减少后续工具调用轮次
  // 根据 contextDepth 决定是否包含某些字段：
  //   minimal  - 仅标题（ID + title）
  //   balanced - 标题 + 简介（加 description / outline.content）
  //   deep     - 标题 + 详细简介（加 detail、完整 outline.content 等）
  // 作品正文写作设置（writingStyle、writingPov、writingTaboo、writingConstraint 等）
  // 默认由 injectWritingSettings 控制注入，与 contextDepth 独立。
  // 如果预加载信息不满足需求，模型会通过工具调用补全。
  let preloadedContextText = ''
  const contextDepth: 'minimal' | 'balanced' | 'deep' = config.contextDepth || 'balanced'
  const MAX_CHAPTERS = 50
  const contextParts: string[] = []

  // 写作意图标记：意图分析预测要写正文时，写作参考上下文由阶段一.6 统一按勾选项注入，
  // 避免与下方预加载的同类大纲/记忆重复。此时预加载阶段跳过这些项。
  const isWriteIntent = !isChatIntent && predictedTools.includes('write_chapter_content')

  // 工具级上下文排除：每个工具在 definition.excludedContexts 声明"执行时不需要的上下文块"。
  // 取所有 predictedTools 排除集合的交集——只有被本轮所有预测工具都排除的块才真正剔除，
  // 防止多工具同轮时误删某工具仍需要的上下文（单工具定稿时即该工具自身声明的排除）。
  const excludedContextKeys = getExcludedContexts(predictedTools)

  // 定稿流程（config.finalize → 走 generate_snapshot）：仅依据章节正文生成记忆，
  // 章节正文与上一章记忆由工具内部自行读取，不需要整书面览/列表面览类上下文。
  // 强制剔除下列块，避免向模型注入无关内容、浪费 token（既覆盖意图分析的预加载块，
  // 也覆盖写作参考勾选的写上下文块——两者都认 excludedContextKeys）。
  // 注意：只作用于定稿，非定稿的写正文等场景不受影响。
  if (config.finalize) {
    excludedContextKeys.add('bookOutline')
    excludedContextKeys.add('chapterList')
    excludedContextKeys.add('volumeOutline')
    excludedContextKeys.add('totalMemory')
  }

  // 在顶层声明变量，后续在上下文中赋值，最终注入到 contextSnapshot
  let snapshotMemoryText: string | undefined

  if (!isChatIntent) {
    const db = getDb()

    // 作品列表
    if (contextNeeds.bookList && !excludedContextKeys.has('bookList')) {
      const bookList = db.select({ id: books.id, title: books.title, description: books.description }).from(books).orderBy(desc(books.createdAt)).all()
      if (bookList.length > 0) {
        const lines = bookList.map((b) => {
          const desc = contextDepth !== 'minimal' && b.description ? b.description : ''
          return `标题: ${b.title};ID: ${b.id}\n简介：${desc}`
        })
        contextParts.push(`#作品列表#\n以下内容作为参考：\n${lines.join('\n')}`)
      }
    }

    // 以下上下文依赖当前选中的书籍
    if (config.bookId) {
      const book = db.select().from(books).where(eq(books.id, config.bookId)).get()

      // 当前作品信息（仅基础元数据：ID/标题/简介/详细设定，不含写作设定）
      if (contextNeeds.bookInfo && book && !excludedContextKeys.has('bookInfo')) {
        const lines: string[] = []
        lines.push('ID:' + book.id)
        lines.push('标题:' + book.title)
        if (contextDepth !== 'minimal' && book.description) {
          lines.push('简介:' + book.description)
        }
        if (contextDepth === 'deep' && book.detail) {
          lines.push('详细设定:' + book.detail)
        }
        contextParts.push(`#当前作品信息\n以下内容作为参考：\n${lines.join('\n')}`)
      }

      // 作品写作设定（独立的系统上下文，固定位置）：始终注入，不受 bookInfo 开关与 contextDepth 限制（显式关闭 injectWritingSettings 时除外）。
      // 位置紧跟 #当前作品信息 之后，保证缓存前缀稳定；仅在有值时注入，避免空块扰动前缀。
      // 整体为硬约束（约束·必遵）：文风指纹/叙事视角/单章期待字数/禁写清单/写作约束，模型必须逐条遵守。
      // 文风指纹优先：写作注入时优先用"按场景勾选"的指纹（config.styleFingerprintId），
      // 其次本书激活指纹（isDefault）；有指纹摘要时替代笼统的 writingStyle 一行——
      // 指纹摘要是带数字锚点的具体约束（句长/对话比/禁止套路词清单），约束力远强于"轻松幽默"这种空泛词。
      if (book && config.injectWritingSettings !== false && !excludedContextKeys.has('bookRequirements')) {
        const reqLines: string[] = []
        if (book.writingTaboo) reqLines.push('禁写清单:' + book.writingTaboo)
        if (book.writingConstraint) reqLines.push('写作约束:' + book.writingConstraint)
        const styleSummary = getWritingStyleSummary(config.bookId, config.styleFingerprintId)
        if (styleSummary) {
          reqLines.push('文风指纹（必遵，逐条遵守）:\n' + styleSummary)
        } else if (book.writingStyle) {
          reqLines.push('写作风格:' + book.writingStyle)
        }
        if (book.writingPov) reqLines.push('叙事视角:' + book.writingPov)
        if (book.writingWordCountTarget) reqLines.push('单章期待字数:' + book.writingWordCountTarget)
        if (reqLines.length > 0) {
          contextParts.push(`#作品写作要求\n以下内容为硬约束（必遵）：\n${reqLines.join('\n')}`)
        }
      }

      // 当前作品大纲
      if (contextNeeds.bookOutline && !excludedContextKeys.has('bookOutline')) {
        const bookOutline = db.select().from(outlines).where(and(eq(outlines.bookId, config.bookId), eq(outlines.type, 'book'))).get()
        if (bookOutline?.content) {
          contextParts.push(`#当前作品大纲\n以下内容作为参考：\n${bookOutline.content}`)
        }
      }

      // 当前作品分卷列表
      if (contextNeeds.volumeList && !excludedContextKeys.has('volumeList')) {
        const volList = db.select({ id: volumes.id, title: volumes.title, sortOrder: volumes.sortOrder, description: volumes.description }).from(volumes).where(eq(volumes.bookId, config.bookId)).orderBy(asc(volumes.sortOrder)).all()
        if (volList.length > 0) {
          const blocks = volList.map((v) => {
            const item: string[] = [`第${v.sortOrder + 1}卷`]
            item.push('标题:' + v.title)
            item.push('ID:' + v.id)
            if (contextDepth !== 'minimal' && v.description) {
              item.push('简介:' + v.description)
            }
            return item.join(';')
          })
          contextParts.push(`#当前作品分卷列表\n以下内容作为参考：\n${blocks.join('\n')}`)
        }
      }

      // 当前作品章节列表（精简版：仅 ID、标题、sortOrder、状态）
      if (contextNeeds.chapterList && !excludedContextKeys.has('chapterList')) {
        const chList = db.select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder, status: chapters.status, volumeId: chapters.volumeId }).from(chapters).where(eq(chapters.bookId, config.bookId)).orderBy(asc(chapters.sortOrder)).limit(MAX_CHAPTERS).all()
        if (chList.length > 0) {
          const extraHint = chList.length >= MAX_CHAPTERS ? `（仅显示前${MAX_CHAPTERS}章，如需更多请指定章节范围或调用工具）` : ''
          const blocks = chList.map((c) => {
            const item: string[] = [`第${c.sortOrder + 1}章`]
            item.push('标题:' + c.title)
            item.push('ID:' + c.id)
            item.push('状态:' + c.status)
            return item.join(';')
          })
          contextParts.push(`#当前作品章节列表${extraHint}\n以下内容作为参考：\n${blocks.join('\n')}`)
        }
      }

      // 指定章节记忆
      if (contextNeeds.chapterMemory && typeof config.currentChapterOrder === 'number' && !excludedContextKeys.has('chapterMemory')) {
        const chMem = db.select({ id: chapters.id, title: chapters.title }).from(chapters).where(and(eq(chapters.bookId, config.bookId), eq(chapters.sortOrder, config.currentChapterOrder))).get()
        if (chMem) {
          const memResult = loadChapterMemoryByOrder(config.bookId, config.currentChapterOrder)
          if (memResult) {
            const specLines: string[] = ['#指定章节记忆', '以下内容作为参考：']
            specLines.push('章节', `第${config.currentChapterOrder + 1}章《${memResult.title || chMem.title}》`)
            specLines.push('内容', serializeChapterMemory(memResult.memory, config.currentChapterOrder, memResult.title || chMem.title))
            contextParts.push(specLines.join('\n'))
          }
        }
      }


      // 当前作品设定列表
      if (contextNeeds.settingList && !excludedContextKeys.has('settingList')) {
        const settings = db.select({ id: bookSettingEntries.id, name: bookSettingEntries.name, type: bookSettingEntries.type }).from(bookSettingEntries).where(eq(bookSettingEntries.bookId, config.bookId)).orderBy(asc(bookSettingEntries.type), asc(bookSettingEntries.createdAt)).all()
        if (settings.length > 0) {
          const byType: Record<string, { name: string; id: string }[]> = {}
          for (const s of settings) {
            if (!byType[s.type]) byType[s.type] = []
            byType[s.type].push({ name: s.name, id: s.id })
          }
          const typeLabels: Record<string, string> = {
            characters: '角色', locations: '地点', items: '物品',
            skills: '技能', scenes: '场景', factions: '势力',
            systems: '体系', inspirations: '灵感', foreshadowings: '伏笔',
          }
          const settingLines: string[] = []
          for (const [type, items] of Object.entries(byType)) {
            settingLines.push(`#${typeLabels[type] || type}#`)
            for (const it of items) {
              settingLines.push('名称', it.name, 'ID', it.id)
            }
          }
          contextParts.push(`#当前作品设定列表#\n以下内容作为参考：\n${settingLines.join('\n')}`)
        }
      }
    }

    preloadedContextText = contextParts.join('\n\n---\n\n')
  }

  // ========== 阶段一.6：统一章节上下文准备 ==========
  // 将"意图分析预测的 contextNeeds"与"写作参考勾选"合并为一份上下文需求，
  // 由 buildWriteContextParts 统一注入一次，彻底消除两条注入路径 + 去重逻辑带来的漏注入/重复。
  // 目标章节：优先用页面传入的 config（Editor 定稿带 chapterId），否则由意图分析结构化输出的 target 解析。
  // 章节序号的唯一来源是意图分析 target（LLM 已把用户输入归一成数字），绝不用正则解析用户输入文本。
  // 需求合并规则：写作意图以"写作参考勾选"为准（用户显式配置）；非写作意图以意图分析 contextNeeds 为准。
  if (!isChatIntent && config.bookId) {
    // 1. 确定 chapterId / volumeId / sortOrder
    let writeChapterId = config.chapterId || null
    let writeVolumeId = config.volumeId || null
    let writeChapterOrder = config.currentChapterOrder

    // Agent 页面发消息时通常没有 chapterId：由意图分析 target 解析章节，不再解析用户输入文本
    if (!writeChapterId) {
      const db = getDb()
      if (intentTarget.kind === 'chapter' && typeof intentTarget.chapterOrder === 'number' && intentTarget.chapterOrder > 0) {
        const order0 = intentTarget.chapterOrder - 1
        const ch = db.select({ id: chapters.id, volumeId: chapters.volumeId, sortOrder: chapters.sortOrder })
          .from(chapters).where(eq(chapters.bookId, config.bookId)).orderBy(asc(chapters.sortOrder)).all()
          .find((c) => c.sortOrder === order0)
        if (ch) {
          writeChapterId = ch.id
          writeVolumeId = ch.volumeId
          writeChapterOrder = ch.sortOrder
        }
      } else if (intentTarget.relation === 'next' || intentTarget.relation === 'prev') {
        // 相对引用（"下一章"/"上一章"/"继续写"）：以当前章节或最新章节为基准
        const baseOrder = typeof config.currentChapterOrder === 'number' ? config.currentChapterOrder : null
        const maxRow = db.select({ sortOrder: chapters.sortOrder }).from(chapters)
          .where(eq(chapters.bookId, config.bookId)).orderBy(desc(chapters.sortOrder)).limit(1).get()
        const maxOrder = maxRow ? maxRow.sortOrder : -1
        const base = baseOrder !== null ? baseOrder : maxOrder
        const targetOrder0 = intentTarget.relation === 'next' ? base + 1 : Math.max(0, base - 1)
        const ch = db.select({ id: chapters.id, volumeId: chapters.volumeId, sortOrder: chapters.sortOrder })
          .from(chapters).where(eq(chapters.bookId, config.bookId)).orderBy(asc(chapters.sortOrder)).all()
          .find((c) => c.sortOrder === targetOrder0)
        if (ch) {
          writeChapterId = ch.id
          writeVolumeId = ch.volumeId
          writeChapterOrder = ch.sortOrder
        }
      }
      if (intentTarget.kind === 'volume' && typeof intentTarget.volumeOrder === 'number' && intentTarget.volumeOrder > 0) {
        const vol = db.select({ id: volumes.id, sortOrder: volumes.sortOrder }).from(volumes)
          .where(eq(volumes.bookId, config.bookId)).orderBy(asc(volumes.sortOrder)).all()
          .find((v) => v.sortOrder === intentTarget.volumeOrder! - 1)
        if (vol) writeVolumeId = vol.id
      }
    }

    // 2. 如果有 chapterId 但缺少 volumeId 或 sortOrder，从数据库补查
    if (writeChapterId && (!writeVolumeId || writeChapterOrder === undefined)) {
      const chRow = getDb().select({ volumeId: chapters.volumeId, sortOrder: chapters.sortOrder })
        .from(chapters).where(eq(chapters.id, writeChapterId)).get()
      if (chRow) {
        if (!writeVolumeId && chRow.volumeId) writeVolumeId = chRow.volumeId
        if (writeChapterOrder === undefined) writeChapterOrder = chRow.sortOrder
      }
    }

    // 3. 合并需求 + 统一注入
    if (writeChapterId || writeChapterOrder !== undefined) {
      const cn = contextNeeds
      // 写作参考勾选的生效条件：
      //   1) 写作意图（LLM 预测 write_chapter_content），或
      //   2) 本次请求明确指向某个章节（Editor 定稿带 chapterId、Agent 页"第X章"文本解析命中）。
      // 命中其一即以用户在设置中勾选的"写作参考"为准，而非依赖 LLM 自行预测的 contextNeeds。
      // 否则回退到意图分析 contextNeeds（读取/查询类对话的唯一触发信号）。
      const useWriteCheckboxes = isWriteIntent || !!writeChapterId
      // 写作意图以"写作参考勾选"为准；非写作意图以意图分析 contextNeeds 为准。
      // 定稿流程（generate_snapshot）不拼装全书总记忆：已通过 excludedContextKeys 从注入项剔除，
      // 这里同步不进调试快照（上下文快照面板），避免定稿步骤仍出现全书总记忆。
      const needTotalMemory = config.finalize
        ? false
        : (useWriteCheckboxes ? (config.writeContextTotalMemory !== false) : !!cn.memory)
      // 记忆快照（用于执行链展示）：总记忆 + 上一章记忆
      if (needTotalMemory) {
        snapshotMemoryText = getMemoryText(config.bookId, writeChapterOrder)
      }
      const writeParts = buildWriteContextParts(config.bookId, {
        volumeId: writeVolumeId,
        chapterId: writeChapterId,
        currentChapterOrder: writeChapterOrder,
        volumeOutline: useWriteCheckboxes ? (config.writeContextVolumeOutline !== false) : !!cn.volumeOutline,
        chapterOutline: useWriteCheckboxes ? (config.writeContextChapterOutline !== false) : !!cn.chapterOutline,
        prevChapterOutline: useWriteCheckboxes ? (config.writeContextPrevChapterOutline !== false) : !!cn.prevChapterOutline,
        prevChapterContent: useWriteCheckboxes ? (config.writeContextPrevChapterContent !== false) : false,
        nextChapterOutline: useWriteCheckboxes ? (config.writeContextNextChapterOutline !== false) : !!cn.nextChapterOutline,
        // 非写作意图下 contextNeeds.memory 含"总记忆 + 上一章记忆"，故两项都跟随
        prevChapterMemory: useWriteCheckboxes ? (config.writeContextPrevChapterMemory !== false) : !!cn.memory,
        totalMemory: needTotalMemory,
        // 工具级上下文排除：在统一入口 buildWriteContextParts 内部按块跳过，
        // 调用方不再逐个 `&& !excluded`，新增块不会漏排除。
        excludedContextKeys,
      })
      for (const part of writeParts) {
        contextParts.push(part)
      }
    }
  }

  // ========== 阶段二：执行 ==========

  // 聊天模式：使用极简提示词，不加载工具定义，最大循环1次
  const maxIterations = isChatIntent ? 1 : MAX_ITERATIONS

  // 所有模型默认尝试原生 function calling，不预先做硬编码判断。
  // 如果 API 不支持 tools 参数，会在运行时自动降级为 JSON 模式重试。

  // 构建系统提示词（只保留静态部分，确保前缀完全一致）
  const buildStaticSystem = (native: boolean) => isChatIntent ? buildMinimalSystemMessage(config.outputLanguage) : buildStaticSystemMessage(native)

  // 构建 messages：系统提示词(铁律) → 数据(预加载上下文) → 工具提示词 → 历史/用户输入
  // 顺序刻意调整为「数据在工具提示词之前」：原顺序把数据夹在工具目录与 predicted 工具提示之间（中段），
  // 易触发 transformer 的 lost-in-the-middle，模型忽略大纲/记忆；现把数据前移至高注意力区，
  // 工具提示词紧贴用户输入之前，让"如何用工具写"成为离请求最近、最被遵循的指令。
  // 注意：数据随请求变化，本顺序会让排在数据之后的工具目录文本退出稳定前缀 → 触发一次前缀缓存重置（预期内，符合批量改提示词约定）。
  const messages: AgentMessage[] = [
    { role: 'system', content: buildStaticSystem(useNativeFunctionCalling) },
  ]

  // 预加载的上下文数据（来自意图分析阶段的需求分析）：放在工具提示词之前（高注意力区）。
  // 每个上下文类型单独作为一条 system 消息，便于命中缓存。
  if (!isChatIntent && contextParts.length > 0) {
    for (const part of contextParts) {
      messages.push({ role: 'system', content: part })
    }
  }

  // 工具目录：作为独立 system 消息注入（原生 FC 模式），与核心铁律分离以各自命中缓存
  if (!isChatIntent && useNativeFunctionCalling) {
    messages.push({ role: 'system', content: buildToolCatalogPrompt() })
  }

  // 根据意图分析预测的工具，提前注入对应的格式指南（在模型首次调用工具之前可见）
  // 这样模型在构造工具参数时就能遵循正确格式，而不是等工具执行完才看到指南
  if (!isChatIntent && predictedTools.length > 0) {
    for (const toolName of predictedTools) {
      const prompt = getToolPrompt(toolName)
      if (prompt) {
        messages.push({ role: 'system', content: prompt })
      }
    }
  }

  // Auto-resume 时注入下一步工具提示词：放在 predicted 工具提示词之后（而非之前），
  // 避免 auto-resume 有无导致后续稳定前缀分叉；其内只含当前步骤相关工具说明。
  if (!isChatIntent && config.appliedPendingWriteTypes && config.appliedPendingWriteTypes.length > 0) {
    const nextPrompts = buildNextStepToolPrompts(config.appliedPendingWriteTypes)
    for (const prompt of nextPrompts) {
      messages.push({ role: 'system', content: prompt })
    }
  }

  // 携带的历史聊天记录：拼接为一条 system 消息注入，明确标注为聊天记录。
  // 避免独立 user/assistant 消息被模型误认为当前指令而干扰工具调用。
  const carriedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (config.history && config.history.length > 0) {
    const maxCtx = config.modelConfig.maxContextTokens && config.modelConfig.maxContextTokens > 0 ? config.modelConfig.maxContextTokens : 0
    const estTokens = (s: string) => Math.ceil(s.length / 1.5)
    // 输入上下文软上限：从最新往最早累加 token，超出则丢弃最早的历史段（防超模型上下文窗口）
    let keepFrom = 0
    if (maxCtx > 0) {
      let used = 0
      for (let i = config.history.length - 1; i >= 0; i--) {
        const h = config.history[i]
        if (!h.content) continue
        const t = estTokens(h.content)
        if (used > 0 && used + t > maxCtx) break
        used += t
        keepFrom = i
      }
    }
    const visibleHistory = config.history.slice(keepFrom)
    const dropped = config.history.length - visibleHistory.length
    const historyLines: string[] = []
    for (const h of visibleHistory) {
      if (!h.content) continue
      const role = h.role === 'assistant' ? 'AI' : '用户'
      carriedHistory.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
      historyLines.push(`【${role}】\n${h.content}`)
    }
    if (historyLines.length > 0) {
      const prefix = dropped > 0 ? `（已省略最早的 ${dropped} 条聊天记录以控制上下文长度）\n\n` : ''
      messages.push({
        role: 'system',
        content: `[CHAT_HISTORY · 聊天记录 · 非当前指令]\n以下是之前的聊天记录，供你理解上下文之用。这些消息已经结束，不需要你对其中的内容做出回应或继续执行。请只关注最后一条用户消息。\n\n${prefix}${historyLines.join('\n\n')}`,
      })
    }
  }

  // 定稿隐藏指令（用户不可见）：放在用户输入之前作为最后一条 system 消息，
  // 既不破坏前面稳定的前缀缓存，又能明确告知模型必须调用 generate_snapshot 完成定稿，
  // 并固定 chapterId，避免模型误改写成正文或自行猜测章节。
  if (config.finalize && config.chapterId) {
    messages.push({
      role: 'system',
      content:
        '#隐藏指令·定稿任务# 你必须立即调用 generate_snapshot 工具为当前章节生成记忆并定稿，' +
        `参数 chapterId 固定为：${config.chapterId}。` +
        '不要改写或续写正文，不要调用 write_chapter_content 等其它写操作工具，只调用 generate_snapshot。' +
        '调用完成后，向用户简短说明已生成章节记忆、请在「知卷」面板确认应用即可。',
    })
  }

  // 用户输入
  messages.push({ role: 'user', content: config.userInput })

  // 工具定义（聊天模式不需要工具；原生FC模式通过 tools 参数传递）
  const toolDefs = isChatIntent ? [] : listToolDefinitions()
  const openaiTools = isChatIntent ? [] : toOpenAITools(toolDefs)

  // 输出 Token 上限：默认 16384；截断重试时动态放大（最多翻倍到 32768）
  let effectiveMaxOutput = config.modelConfig.maxOutputTokens && config.modelConfig.maxOutputTokens > 0
    ? config.modelConfig.maxOutputTokens
    : 16384

  // 主循环
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (config.signal?.aborted) {
      aborted = true
      break
    }

    const roundNumber = rounds.length + 1
    let roundUsage: any = undefined
    let roundDurationMs: number | undefined

    // 构建模型 payload
    const payload: AgentModelPayload = {
      baseUrl: config.modelConfig.baseUrl,
      apiKey: config.modelConfig.apiKey,
      modelName: config.modelConfig.modelName,
      messages: messages.map((m) => ({
        role: m.role as any,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 回复生成内置默认 0.7
      ...resolveSamplingParams(config.modelConfig, 'agentReply'),
      stream: true,
      streamTimeout: config.streamTimeout,
      maxOutputTokens: effectiveMaxOutput,
      mergeSystemMessages: config.modelConfig.mergeSystemMessages,
      ...(useNativeFunctionCalling ? { tools: openaiTools, tool_choice: 'auto' as const } : {}),
    }

    // 保存本轮输入快照（原始数据，用于前端执行链展示）
    const roundInput = JSON.parse(JSON.stringify(payload.messages))

    let responseContent = ''
    let responseToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | null | undefined = null
    let finishReason: string | null = null
    const roundStartAt = Date.now()

    if (iteration > 0) {
      try { config.onChunk?.('\n\n') } catch { }
    }

    try {
      const result = await runAgentModel(payload, {
        signal: config.signal,
        onChunk: (delta) => {
          config.onChunk?.(delta)
        },
        onReasoning: (delta) => {
          config.onReasoning?.(delta)
        },
      })

      responseContent = result.content || ''
      // 聚合本轮整段推理文本（覆盖"只在最终响应返回 reasoning、流式不触发"的模型）
      if (result.reasoning) {
        accumulatedReasoning += (accumulatedReasoning ? '\n\n' : '') + result.reasoning
      }
      responseToolCalls = result.toolCalls
      finishReason = result.finishReason || null

      roundDurationMs = Date.now() - roundStartAt
      if (result.usage) {
        totalPromptTokens += result.usage.prompt_tokens || 0
        totalCompletionTokens += result.usage.completion_tokens || 0
        const cached = result.usage.prompt_tokens_details?.cached_tokens
          ?? result.usage.prompt_cache_hit_tokens
          ?? result.usage.cache_read_input_tokens
          ?? result.usage?.cached_tokens
        if (cached !== undefined && cached !== null) {
          totalCachedPromptTokens = (totalCachedPromptTokens || 0) + Number(cached)
        }
        const reasoning = result.usage.completion_tokens_details?.reasoning_tokens
        if (reasoning !== undefined && reasoning !== null) {
          totalReasoningTokens = (totalReasoningTokens || 0) + Number(reasoning)
        }
        roundUsage = {
          promptTokens: result.usage.prompt_tokens || 0,
          completionTokens: result.usage.completion_tokens || 0,
          ...(cached !== undefined && cached !== null ? { cachedTokens: Number(cached) } : {}),
          ...(reasoning !== undefined && reasoning !== null ? { reasoningTokens: Number(reasoning) } : {}),
        }
      }

      if (result.aborted) {
        aborted = true
        break
      }
    } catch (err: any) {
      const errMsg = err?.message || ''
      if (useNativeFunctionCalling && !jsonFallbackTried && isToolsNotSupportedError(errMsg)) {
        jsonFallbackTried = true
        useNativeFunctionCalling = false
        messages[0] = { role: 'system', content: buildStaticSystem(false) }
        config.onChunk?.('\n\n[当前模型不支持原生工具调用，已切换为 JSON 兼容模式重试…]\n\n')
        continue
      }
      // 模型调用失败：不抛错，而是把错误作为本轮 entry 推入执行链 + 累计已发生的耗时，
      // 保留 token 统计和 contextSnapshot.rounds，让 UI 仍能看到这一轮（标红/显示错误原因）+ 总花费。
      // 与"用户主动 stop"区分：errored=true 表示模型端报错，aborted=true 表示用户取消。
      roundDurationMs = Date.now() - roundStartAt
      const errorLabel = `第 ${roundNumber} 轮 · 模型调用失败`
      rounds.push({
        label: errorLabel,
        input: roundInput,
        output: [{ role: 'assistant', content: `[模型调用失败] ${errMsg}` }],
        usage: undefined,
        durationMs: roundDurationMs,
        finishReason: 'error',
      })
      modelRunError = errMsg
      break
    }

    // 解析工具调用
    let toolCalls: ToolCall[] = []
    let displayContent = responseContent
    let assistantMessageContent = responseContent

    if (useNativeFunctionCalling && responseToolCalls && responseToolCalls.length > 0) {
      toolCalls = parseNativeToolCalls(responseToolCalls)
      // 原生 FC 模式下也尝试剥离 content 中的 JSON 代码块，防止模型在 content 中重复输出工具调用 JSON
      const parsed = parseJsonToolCalls(responseContent)
      displayContent = parsed.remainingText
      assistantMessageContent = parsed.remainingText || responseContent
    } else if (useNativeFunctionCalling) {
      const parsed = parseJsonToolCalls(responseContent)
      if (parsed.toolCalls.length > 0) {
        toolCalls = parsed.toolCalls
        displayContent = parsed.remainingText
        assistantMessageContent = parsed.remainingText
      }
    } else if (!useNativeFunctionCalling) {
      const parsed = parseJsonToolCalls(responseContent)
      toolCalls = parsed.toolCalls
      displayContent = parsed.remainingText
      assistantMessageContent = parsed.remainingText
    }

    // 构建 label 和本轮输出
    const label = toolCalls.length > 0
      ? `第 ${roundNumber} 轮 · 调用${[...new Set(toolCalls.map((t) => TOOL_NAME_CN[t.name] || t.name))].join('、')}`
      : `第 ${roundNumber} 轮 · 生成回复`
    const nativeToolCallsPresent = !!(useNativeFunctionCalling && responseToolCalls && responseToolCalls.length > 0)

    // 模型原始输出：文本内容 + 工具调用（保留原始 content 用于调试展示）
    const roundOutput = [{
      role: 'assistant',
      content: responseContent,
      ...(nativeToolCallsPresent ? { tool_calls: responseToolCalls } : {}),
    }]

    // 把 assistant 消息加入 messages（使用剥离后的 content 避免干扰下一轮）
    if (nativeToolCallsPresent) {
      messages.push({
        role: 'assistant',
        content: assistantMessageContent,
        tool_calls: responseToolCalls as Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>,
      })
    } else {
      messages.push({
        role: 'assistant',
        content: assistantMessageContent,
      })
    }

    // 记录本轮 input + output
    rounds.push({ label, input: roundInput, output: roundOutput, usage: roundUsage, durationMs: roundDurationMs, finishReason })

    // 截断防护：输出触顶（finish_reason==='length'）且未解析出完整工具调用 → 放大上限重试，
    // 避免残缺 JSON 被 jsonrepair 侥幸"修好"后带着残缺参数（如残缺章节正文）直接执行。
    const truncatedRetryCount = messages.filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('LENGTH_TRUNCATED')).length
    if (finishReason === 'length' && toolCalls.length === 0 && truncatedRetryCount < 2) {
      effectiveMaxOutput = Math.min(effectiveMaxOutput * 2, 32768)
      messages.push({
        role: 'user',
        content: `[SYSTEM · LENGTH_TRUNCATED]\n上一轮输出因达到 token 上限(max_tokens=${effectiveMaxOutput / 2})被截断，tool_call JSON 不完整。已自动将输出上限放大至 ${effectiveMaxOutput}，请一次性完整输出所有 tool_call，不要分批。`,
      })
      continue
    }

    // 如果没有工具调用 → 最终回复
    if (toolCalls.length === 0) {
      // JSON 模式下检测疑似格式错误：content 含 tool_call 块或工具名关键词但解析出 0 个调用
      const hasToolCallBlock = /```tool_call/.test(responseContent)
      const hasToolKeywords = /(create_chapters|create_volumes|create_settings|write_chapter_content|write_book_outline|with\s+(chapters|volumes|settings)\s+is|is_prerequisite\s+(is|true|false))/.test(responseContent)
      const looksLikeGarbledToolCall = !useNativeFunctionCalling
        && (hasToolCallBlock || hasToolKeywords)
        && !/已生成|请在下方|预览确认/.test(responseContent)
        && displayContent.length > 0

      if (looksLikeGarbledToolCall) {
        // 注入格式错误提示，让模型用正确 JSON 重试（最多重试 2 次，防止死循环）
        const retryCount = (messages.filter(m => m.role === 'user' && m.content.includes('PARSE_ERROR')).length)
        if (retryCount < 2) {
          messages.push({
            role: 'user',
            content: '[SYSTEM · PARSE_ERROR]\n你上一轮输出的 tool_call 代码块格式有误：代码块内必须只包含合法 JSON 数组，不能掺杂任何自然语言文本。请严格按照以下格式重新输出：\n\n```tool_call\n[{ "id": "call_1", "name": "工具名", "arguments": { "参数名": "参数值" } }]\n```',
          })
          continue
        }
      }

      finalContent = displayContent
      break
    }

    for (const tc of toolCalls) {
      config.onToolStart?.(tc)
    }

    // 去重：拦截同一 run 内重复调用的写工具，防止同一目标产出多个 pendingWrite
    const dedupedCalls: ToolCall[] = []
    const duplicateResultMap = new Map<number, ToolResult>()
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      // 硬闸：本次请求早前轮次已产出待确认卡片后，后续轮次的写工具一律不再执行。
      // 下一步应由"用户应用卡片 → 系统自动续跑"触发，而不是模型在同一请求内自由发挥抢跑
      //（例如章节卡尚未应用就直接写正文——此时章节还不存在，只会产出脏数据或报错）。
      // 同一轮内并行产出多张前置卡不受影响（此时 allPendingWrites 尚未收集本轮结果）。
      if (allPendingWrites.length > 0 && getTool(tc.name)?.definition.mode === 'write') {
        duplicateResultMap.set(i, {
          id: tc.id,
          name: tc.name,
          success: false,
          data: null,
          error: '本次请求已产出待用户确认的卡片，禁止在同一请求内继续执行新的写操作。后续步骤会在用户应用卡片后由系统自动续跑触发。请直接输出面向用户的最终中文回复，不要再调用任何工具。',
        })
        continue
      }
      const args = (tc.arguments && typeof tc.arguments === 'object') ? tc.arguments as Record<string, any> : {}
      const dedupKey = getWriteDedupKey(tc.name, args, config.bookId)
      if (dedupKey && calledWriteTargets.has(dedupKey)) {
        duplicateResultMap.set(i, {
          id: tc.id,
          name: tc.name,
          success: true,
          data: { message: '该写操作已在本轮提交，请勿重复调用。等待用户在卡片中预览确认后即可生效。' },
        })
      } else {
        if (dedupKey) calledWriteTargets.add(dedupKey)
        dedupedCalls.push(tc)
      }
    }

    // 工具内部模型调用的记录回调——追加到执行链作为子节点
    const toolExecStartAt = Date.now()
    const onSubModelCall = (entry: { label: string; input: Array<{ role: string; content: string }>; output: Array<{ role: string; content: string }>; durationMs: number; usage?: any }) => {
      const u = entry.usage
      // 子调用的 tokens 也需要累加到全局 totals（用于费用计算和 token_usage_logs）
      if (u) {
        totalPromptTokens += u.prompt_tokens ?? 0
        totalCompletionTokens += u.completion_tokens ?? 0
        const cached = u.prompt_tokens_details?.cached_tokens
          ?? u.prompt_cache_hit_tokens
          ?? u.cache_read_input_tokens
          ?? u?.cached_tokens
        if (cached !== undefined && cached !== null) {
          totalCachedPromptTokens = (totalCachedPromptTokens ?? 0) + Number(cached)
        }
        const reasoning = u.completion_tokens_details?.reasoning_tokens
        if (reasoning !== undefined && reasoning !== null) {
          totalReasoningTokens = (totalReasoningTokens ?? 0) + Number(reasoning)
        }
      }
      let subUsage: any = undefined
      if (u) {
        const subCached = u.prompt_tokens_details?.cached_tokens
          ?? u.prompt_cache_hit_tokens
          ?? u.cache_read_input_tokens
          ?? u.cached_tokens
        const subReasoning = u.completion_tokens_details?.reasoning_tokens
        subUsage = {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          ...(subCached !== undefined && subCached !== null ? { cachedTokens: Number(subCached) } : {}),
          ...(subReasoning !== undefined && subReasoning !== null ? { reasoningTokens: Number(subReasoning) } : {}),
        }
      }
      rounds.push({
        label: `  └ ${entry.label}`,
        input: entry.input,
        output: entry.output,
        usage: subUsage,
        durationMs: entry.durationMs,
      })
    }
    const { results: executedResults, pendingWrites } = dedupedCalls.length > 0
      ? await executeToolCalls(dedupedCalls, {
        bookId: config.bookId,
        chapterId: config.chapterId,
        volumeId: config.volumeId,
        modelId: config.modelId,
        onSubModelCall,
        onReasoning: config.onReasoning,
      })
      : { results: [] as ToolResult[], pendingWrites: [] as PendingWrite[] }

    // 合并结果：按原始 toolCalls 顺序还原（重复调用的位置插入合成结果）
    const results: ToolResult[] = []
    let executedIdx = 0
    for (let i = 0; i < toolCalls.length; i++) {
      if (duplicateResultMap.has(i)) {
        results.push(duplicateResultMap.get(i)!)
      } else {
        results.push(executedResults[executedIdx++])
      }
    }

    // 将工具执行耗时追加到上一轮的 durationMs 中（工具执行包含 computeChapterSnapshot 等内部模型调用）
    const toolExecDurationMs = Date.now() - toolExecStartAt
    if (rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1]
      lastRound.durationMs = (lastRound.durationMs || 0) + toolExecDurationMs
    }

    for (let i = 0; i < toolCalls.length; i++) {
      toolCallHistory.push({ call: toolCalls[i], result: results[i] })
    }

    if (nativeToolCallsPresent) {
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push({
          role: 'tool',
          content: JSON.stringify(results[i].data || { error: results[i].error }),
          tool_call_id: toolCalls[i].id,
          name: toolCalls[i].name,
        })
      }
      // 原生 FC 模式：本轮产出了待确认卡片时，明确要求模型收尾，禁止继续调用工具。
      // （JSON 降级模式在下方 else 分支的 instructionText 里已有同语义指令，此前原生模式缺失，
      //   导致模型在卡片未应用前就"自由发挥"执行下一步。）
      if (pendingWrites.length > 0) {
        messages.push({
          role: 'user',
          content: '[SYSTEM · WRITE_DONE · 非用户消息]\n以上写操作已生成待用户确认的卡片，本次请求的写任务到此为止。这是硬性要求：请直接输出面向用户的最终中文回复，简要说明已生成哪些内容等待确认；禁止再调用任何工具，禁止开始下一步操作——后续步骤会在用户应用卡片后由系统自动续跑触发。',
        })
      }
    } else {
      const resultText = results
        .map((r) => `【工具:${r.name}】 (call_id=${r.id})\n${r.success ? JSON.stringify(r.data, null, 2) : `执行失败：${r.error}`}`)
        .join('\n\n')

      // 判断本轮工具类型，调整后续行为提示
      const writeToolNames = toolCalls.filter(tc => getTool(tc.name)?.definition.mode === 'write').map(tc => tc.name)
      const hasWriteTool = writeToolNames.length > 0
      const hasReadTool = toolCalls.some(tc => getTool(tc.name)?.definition.mode === 'read')

      let instructionText: string
      if (hasWriteTool && !hasReadTool) {
        // 本轮只有 write 工具：写操作已生成待确认卡片，任务已完成
        instructionText = `\n以上 write 类工具已生成待用户确认的卡片，任务已完成。这是硬性要求：你当前回复中必须**直接输出面向用户的最终中文回复**，禁止再输出任何 \`\`\`tool_call\`\`\` 代码块，禁止在本请求内再次调用任何工具（尤其不要重复调用 ${writeToolNames.join('、')}）。`
      } else if (hasWriteTool && hasReadTool) {
        // 混合模式：read 部分可以继续查询，但 write 部分已完成
        instructionText = `\n① write 类工具（${writeToolNames.join('、')}）已生成待确认卡片，当前请求中禁止再次调用；\n② 如果 read 查询部分还有未完成的工具需要调用，继续输出 \`\`\`tool_call ...\`\`\` 代码块；\n③ 如果全部任务已完成，直接输出面向用户的最终中文回复（禁止包含任何工具代码块，禁止在本请求内再次调用 write 类工具）。`
      } else {
        // 只有 read 工具：保持原有提示
        instructionText = `\n① 如果还有未完成的工具需要调用，继续输出 \`\`\`tool_call ...\`\`\` 代码块；\n② 如果任务已完成，直接输出面向用户的最终中文回复（不要包含代码块，也不要重复复述工具结果 JSON）。`
      }

      const toolResultContent = `[SYSTEM · TOOL_RESULT · 非用户消息]\n以下是你上一轮调用的工具的执行结果，请基于它们继续下一步动作：${instructionText}\n\n${resultText}`
      messages.push({
        role: 'user',
        content: toolResultContent,
      })
    }

    for (const pw of pendingWrites) {
      allPendingWrites.push(pw)
      // 实时把卡片推给前端（agent:pendingWrite 事件），不等整次运行结束。
      // 否则模型后续轮次（尤其推理模型）耗时较长时，用户会长时间停留在"思考中"却看不到卡片。
      config.onPendingWrite?.(pw)
    }

    for (const r of results) {
      config.onToolEnd?.(r)
    }
  }

  // 如果达到最大循环次数还没结束
  if (!aborted && !finalContent && !modelRunError && messages.length > 0) {
    finalContent = '已完成所有工具调用，但未生成最终回复。请根据上述操作结果继续对话。'
  }

  // 模型调用失败时把错误原因以「前缀 + 错误消息」形式写进 content，UI 直接展示。
  // 同时通过 errored / errorMessage 字段让调用方知道这是失败收尾（不是自然完成也不是用户中断）。
  if (modelRunError) {
    finalContent = finalContent
      ? `${finalContent}\n\n[模型调用失败] ${modelRunError}`
      : `[模型调用失败] ${modelRunError}`
  }

  return {
    content: finalContent,
    // 整段推理文本（按轮聚合）。流式推理已由 onReasoning 实时落库；此处兜底覆盖"只在最终响应返回 reasoning"的模型。
    // agent.ipc 会把该字段原样转发到 agent:done，store 在 onDone 以 `bufferedReasoning || data.reasoning` 顺序写入 message.reasoningContent。
    reasoning: accumulatedReasoning || null,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      ...(totalCachedPromptTokens !== undefined ? { cachedPromptTokens: totalCachedPromptTokens } : {}),
      ...(totalReasoningTokens !== undefined ? { reasoningTokens: totalReasoningTokens } : {}),
      cost: totalCost,
    },
    pendingWrites: allPendingWrites,
    toolCallHistory,
    // 模型调用次数：每轮模型请求算一次（意图分析 1 轮 + 主循环每轮 + 工具内部子调用）。
    // 与 rounds 数组一一对应（rounds 仅记录带 usage 的模型调用），用于 token 日志"调用次数"统计。
    modelCalls: rounds.length,
    aborted,
    ...(modelRunError
      ? { errored: true, errorMessage: modelRunError }
      : {}),
    // 兼容字段：只要有任何一张 pendingWrite 被标为前置，就等同于旧的消息级 resumeAfterApply=true。
    // 前端 shouldAutoResume 主逻辑其实是"检查 pendingWrites 里的 isPrerequisite 标记"，
    // 这里保留字段方便过渡期日志/UI 徽标读取。
    resumeAfterApply: allPendingWrites.some((w: any) => w.isPrerequisite === true),
    contextSnapshot: {
      systemPrompt: [
        ...intentionMessages.filter((m) => m.role === 'system').map((m) => m.content),
        ...messages.filter((m) => m.role === 'system').map((m) => m.content),
      ].join('\n\n'),
      staticSystemPrompt: [
        ...intentionMessages.filter((m) => m.role === 'system').map((m) => m.content),
        ...messages.filter((m) => m.role === 'system').map((m) => m.content),
      ].join('\n\n'),
      dynamicContext: undefined,
      memoryText: snapshotMemoryText,
      semiStaticContext: undefined,
      tools: toolDefs,
      userInput: config.userInput,
      modelName: config.modelConfig.modelName,
      fullMessages: [...intentionMessages, ...messages],
      chatHistory: carriedHistory,
      rounds,
    },
  }
}

/**
 * 判定是否是"服务端不支持 function calling"类错误。
 *
 * 覆盖了实际线上遇到的多种 OpenAI-兼容实现的措辞变体：
 *  - OpenAI 官方：`Unknown parameter: 'tools'` / `tool_choice` / `not supported`
 *  - Ollama：`unexpected key: tools` / `parameter tools not recognized`
 *  - vLLM / Together：`function calling is not supported by this model`
 *  - 部分兼容层：`'tools' is not a valid property` / `parameter 'tools' rejected`
 *  - 一些国产接口：`工具调用未开启` / `不支持 function`
 *
 * 注意：**必须先排除"schema 层错误"**（如 tools[0].function.parameters 校验失败），
 * 那类错误信息里也会出现 tools 关键词，但降级并不能解决问题，只会让 Agent 用错误路径继续跑。
 */
function isToolsNotSupportedError(message: string): boolean {
  if (!message) return false
  const raw = message
  const lower = raw.toLowerCase()

  // ---- 先排除：schema / 参数格式错误（含 tools 关键词，但降级无法解决）----
  // 例："invalid tools[0].function.parameters"、"tools[0].function.name must be..."
  if (/tools?\[\d+\]/.test(raw)) return false
  if (/function\.parameters|function\.name|function\.description/i.test(raw)) return false

  // ---- 明确的"不支持"信号 ----
  const notSupportedSignals = [
    'function calling is not supported',
    'function_call is not supported',
    'function-calling is not supported',
    'tool calling is not supported',
    'tools is not supported',
    "'tools' is not supported",
    "'tools' is not a valid",
    'tools not supported',
    'parameter tools not recognized',
    'parameter \'tools\' rejected',
    'unexpected key: tools',
    'unexpected key "tools"',
    "unexpected key 'tools'",
    'unknown parameter: tools',
    'unknown parameter \'tools\'',
    'unrecognized parameter: tools',
    'invalid parameter: tools',
    'invalid parameter: tool_choice',
    'unknown parameter: tool_choice',
    'unrecognized parameter: tool_choice',
    'unknown request parameter',
    '不支持 function',
    '不支持function',
    '工具调用未开启',
    '未启用工具',
  ]
  for (const sig of notSupportedSignals) {
    if (lower.includes(sig)) return true
  }

  // ---- 更宽松的 "tools" + 负面词组合（放在最后作兜底）----
  if (
    lower.includes('tools')
    && (lower.includes('unrecognized') || lower.includes('not supported') || lower.includes('unknown parameter'))
  ) {
    return true
  }
  return false
}

/** 流式输出文本（分块模拟流式效果） */
export function streamText(text: string, onChunk: (delta: string) => void, signal?: AbortSignal) {
  if (!text) return
  const chunks = text.match(/[\s\S]{1,20}/g) || [text]
  for (const chunk of chunks) {
    if (signal?.aborted) break
    onChunk(chunk)
  }
}
