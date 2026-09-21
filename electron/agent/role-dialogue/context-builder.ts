/**
 * Context Builder
 *
 * 为每个角色独立拼装 system prompt + 私有上下文。
 *
 * 输入：
 *   - 角色档案（bookSettingEntries.type='characters'）
 *   - 角色当前状态（bookMemory.characters[].currentState / chapterSnapshots）
 *   - 公开聊天流（所有片段的 publicContent，按顺序拼接）
 *   - 累积的事实（所有片段的 authorFactUpdate，按顺序拼接）
 *   - 写作设置（可选，房间 injectWritingSettings=true 时注入）
 *   - 章节上下文（可选，房间 chapterId 时：章节大纲 + 已写正文 + 该角色最近章节记忆）
 *
 * 输出：OpenAI messages 数组
 *   - system：角色扮演指令 + 角色档案 + 当前状态 + 写作设置
 *   - user:   "当前情境" + "已发生事实" + "最近对话" + "本轮情境"
 *   - assistant: （无）
 *   - 让模型以单次 assistant 消息返回纯文本（剧情），不再走 JSON 结构
 *
 * 边界：
 *   - 超出 maxTokens 时按"最早聊天先截断"策略（保留最新的）
 *   - 简单用字符数估算 token（中文 ~ 1.5 字符/token，英文 ~ 4 字符/token，简化为长度 / 2）
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db'
import {
  books,
  bookSettingEntries,
  bookMemory,
  chapters,
  chapterSnapshots,
  roleDialogueRooms,
  roleDialogueSnippets,
  roleDialogueRuns,
} from '../../db/schema'
import type { SnippetMessage } from './types'
import { getActiveStyleSummary } from '../style'

/**
 * "结果提示"文案标记（与 snippet-runner 中保持一致）。
 * 用于识别模型调用失败 / 空输出 / 拒绝生成 等"整气泡都是错误信息"的片段内容，
 * 这类片段只展示给用户看，不注入到后续角色的 prompt 上下文里。
 */
export const SNIPPET_EMPTY_RESULT_MARKER = '（模型返回为空，未生成台词）'
export const SNIPPET_ERROR_RESULT_PREFIX = '（模型调用失败：'
export const SNIPPET_REFUSED_RESULT_PREFIX = '（模型拒绝生成：'

/**
 * 判定片段内容是否为"结果提示"（空 / 失败 / 拒绝）。
 * context-builder 与 snippet-runner 共用这一份判定（单一来源），
 * 保证：失败片段只展示给用户、不污染后续模型上下文。
 */
export function isSnippetResultNotice(content: string | null | undefined): boolean {
  if (!content) return false
  return content === SNIPPET_EMPTY_RESULT_MARKER
    || content.startsWith(SNIPPET_ERROR_RESULT_PREFIX)
    || content.startsWith(SNIPPET_REFUSED_RESULT_PREFIX)
}

/**
 * 综合判定一条 SnippetMessage 是否属于"结果提示"（应跳过上下文注入）。
 * 既覆盖 m.errorNotice 有值的情形（部分产出 + 错误，错误信息走 errorNotice 列），
 * 也覆盖 m.publicContent 整段都是错误信息的情形（完全没产出时整气泡是错误消息）。
 */
function isNoticeMessage(m: SnippetMessage): boolean {
  if (m.errorNotice) return true
  return isSnippetResultNotice(m.publicContent)
}

export type BuiltContext = {
  /** 给模型看的完整 messages 数组 */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  /** 估算 token 数（供 UI 调试） */
  estimatedTokens: number
}

export type BuildContextArgs = {
  bookId: string
  roomId: string
  runId: string
  /** 当前要生成发言的角色 id */
  characterId: string
  /** 本片段的角色顺序（用于在 system 中标注"接下来你会发言"） */
  characterIdsInSnippet: string[]
  /** 本片段"前置事实"（作者最近插入的事实；片段级） */
  authorFact?: string | null
  /** 本片段生成上下文时已经存在的所有"前序"片段消息（这些已经进入公开流，不需要重发） */
  existingSnippets: Array<{
    order: number
    /** 标记该片段是否为 summary 类型；summary 自身需要被注入（作为锚点），但 summary 之前的内容已被其覆盖、不再注入 */
    kind?: 'snippet' | 'summary'
    /** summary 内的 consolidatedContent（messages[0].publicContent） */
    summaryContent?: string
    /** summary 视角名（messages[0].characterName） */
    summaryViewName?: string
    messages: SnippetMessage[]
    authorFactUpdate: { fact: string; insertedAt: string } | null
  }>
  /** 单片段最大 token 预算（默认 8000） */
  maxTokens?: number
}

/** 简单估算 token 数：粗略按"中英混合 1 token ≈ 1.5 个字符" */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

export function buildCharacterContext(args: BuildContextArgs): BuiltContext {
  const {
    bookId,
    roomId,
    runId,
    characterId,
    characterIdsInSnippet,
    authorFact,
    existingSnippets,
    maxTokens = 8000,
  } = args

  const db = getDb()

  // 查角色：先 bookSettingEntries（设定），再 bookMemory（临时人物/只在记忆里）
  const findCharacter = (cid: string) => {
    const fromSetting = db.select().from(bookSettingEntries)
      .where(and(eq(bookSettingEntries.id, cid), eq(bookSettingEntries.bookId, bookId)))
      .get()
    if (fromSetting) return fromSetting
    const memRow = db.select({ data: bookMemory.data })
      .from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()
    if (!memRow?.data) return null
    try {
      const v = JSON.parse(memRow.data)
      const m = v?.characters?.find?.((c: any) => c.id === cid)
      if (!m) return null
      return {
        id: m.id,
        bookId,
        type: 'characters',
        name: m.name,
        description: m.description || '',
        detail: m.detail || '',
        createdAt: '',
        updatedAt: '',
      } as any
    } catch {
      return null
    }
  }

  // 1. 读取角色档案
  const character = findCharacter(characterId)
  if (!character) {
    throw new Error(`角色不存在：${characterId}`)
  }
  const characterName = character.name

  // 2. 读取房间（含 situation / chapterId / injectWritingSettings / defaultModelId）
  const room = db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, roomId)).get()
  if (!room) throw new Error(`房间不存在：${roomId}`)

  // 3. 读取书籍（写作设置）
  const book = db.select().from(books).where(eq(books.id, bookId)).get()

  // 4. 角色当前状态（bookMemory.characters 数组里匹配 characterId）
  let characterState = ''
  const memRow = db.select({ data: bookMemory.data })
    .from(bookMemory)
    .where(eq(bookMemory.bookId, bookId))
    .get()
  if (memRow?.data) {
    try {
      const v = JSON.parse(memRow.data)
      const charState = v?.characters?.find?.((c: any) => c.id === characterId)
      if (charState) {
        // 防御：任何字段都可能是对象，转字符串避免 [object Object]
        const toStr = (v: any): string => {
          if (v == null) return ''
          if (typeof v === 'string') return v
          try { return JSON.stringify(v) } catch { return String(v) }
        }
        characterState = [
          toStr(charState.currentState) ? `当前状态：${toStr(charState.currentState)}` : '',
          toStr(charState.location) ? `当前位置：${toStr(charState.location)}` : '',
          toStr(charState.status) ? `处境/处境：${toStr(charState.status)}` : '',
        ].filter(Boolean).join('\n')
      }
    } catch {}
  }

  // 5. 章节上下文（如果房间锚定了章节）
  let chapterContext = ''
  if (room.chapterId) {
    const ch = db.select().from(chapters).where(eq(chapters.id, room.chapterId)).get()
    if (ch) {
      const outline = ch.outline ? `\n- 大纲：${ch.outline}` : ''
      const content = ch.content ? `\n- 已写正文（前 800 字）：${ch.content.slice(0, 800)}` : ''
      chapterContext = `【所在章节】${ch.title}${outline}${content}`
    }
  }

  // 6. 累积事实（所有片段的 authorFactUpdate，按顺序拼接）
  //    summary 截断：找到最近一条 summary，只取它之后的事实（之前的片段已被总结覆盖，不再参与上下文）
  let snippetsForContext = existingSnippets
  let lastSummaryIdx = -1
  for (let i = existingSnippets.length - 1; i >= 0; i--) {
    if (existingSnippets[i].kind === 'summary') { lastSummaryIdx = i; break }
  }
  if (lastSummaryIdx >= 0) {
    snippetsForContext = existingSnippets.slice(lastSummaryIdx)
  }

  const allFacts: Array<{ fact: string; at: string }> = []
  for (const s of snippetsForContext) {
    if (s.authorFactUpdate) {
      allFacts.push({ fact: s.authorFactUpdate.fact, at: `片段 #${s.order} 前` })
    }
  }
  if (authorFact) {
    allFacts.push({ fact: authorFact, at: '本片段前' })
  }
  const factsText = allFacts.length > 0
    ? allFacts.map((f) => `- [${f.at}] ${f.fact}`).join('\n')
    : '（暂无作者裁定事实）'

  // 7. 公开聊天流（所有片段的 publicContent，按角色名标注）
  // 关键：错误信息（errorNotice 或整气泡是错误消息）一律不进入"已发生事实"——
  // 避免错误消息被注入到后续角色的 prompt 当作对话历史（用户反馈：模型失败信息被其他角色看见后继续回应）。
  // 角色标签：当前要发言的角色（自己）标为「我」，其他角色标为「角色名」——
  // 避免 history 里出现「你」字污染模型输出（用户反馈：模型会照抄 history 里的"你"出现在剧情正文里）。
  // summary 类型片段：以单条 consolidatedContent 形式注入（作为上下文锚点），不再展开为多角色对话。
  const publicChatText = snippetsForContext.length === 0
    ? '（暂无公开对话）'
    : snippetsForContext.map((s) => {
      if (s.kind === 'summary') {
        const content = s.summaryContent || s.messages[0]?.publicContent || ''
        const viewName = s.summaryViewName || s.messages[0]?.characterName || '旁白视角'
        return `【总结片段 #${s.order} · ${viewName}】\n${content}`
      }
      const lines = s.messages.map((m) => {
        if (isNoticeMessage(m)) return null
        const tag = m.characterId === characterId ? '我' : m.characterName
        return `  ${tag}：${m.publicContent}`
      }).filter((line): line is string => line !== null).join('\n')
      return `【片段 #${s.order}】\n${lines}`
    }).join('\n\n')

  // 8. 该角色的内心独白历史（仅该角色之前产生过的 innerThought）
  const myInnerThoughts: string[] = []
  for (const s of snippetsForContext) {
    for (const m of s.messages) {
      if (m.characterId === characterId && m.innerThought && m.innerThought.trim()) {
        myInnerThoughts.push(`[片段 #${s.order}] ${m.innerThought.trim()}`)
      }
    }
  }
  const innerThoughtText = myInnerThoughts.length > 0
    ? myInnerThoughts.join('\n')
    : '（暂无）'

  // 9. 写作设置注入
  let writingSettingsText = ''
  if (room.injectWritingSettings && book) {
    const parts: string[] = []
    // 文风指纹优先：有激活指纹摘要时注入量化约束，替代笼统的 writingStyle 一行
    const styleSummary = getActiveStyleSummary(book.id)
    if (styleSummary) {
      parts.push(`文风指纹（必遵）：\n${styleSummary}`)
    } else if (book.writingStyle) {
      parts.push(`文风：${book.writingStyle}`)
    }
    if (book.writingPov) parts.push(`叙事视角：${book.writingPov}`)
    if (book.writingTaboo) parts.push(`禁忌：${book.writingTaboo}`)
    if (book.writingConstraint) parts.push(`写作约束：${book.writingConstraint}`)
    if (parts.length > 0) {
      writingSettingsText = `\n# 写作设置参考\n${parts.join('\n')}`
    }
  }

  // 10. 拼装 system（拆分为「共享前缀」+「角色专属」，让共享前缀跨角色命中前缀缓存）
  //     sharedSystemContent：只依赖房间/书籍（情境/章节/写作设置/输出格式），与具体角色无关
  //                          → 同一房间内所有角色完全相同，可命中前缀缓存。
  //     specificSystemContent：含角色名/设定/状态/在场其他人/发言位置 → 每个角色不同，放其后。
  const isMultiCharacter = characterIdsInSnippet.length > 1
  const positionInSnippet = characterIdsInSnippet.indexOf(characterId) + 1
  const positionHint = isMultiCharacter
    ? `你将在本片段中以第 ${positionInSnippet} 位发言（共 ${characterIdsInSnippet.length} 位角色）。`
    : '本片段只有你一个角色发言。'

  const otherCharactersHint = isMultiCharacter
    ? `本次在场的其他角色（仅告知姓名与简短身份，不剧透其私密背景）：${characterIdsInSnippet
        .filter((id) => id !== characterId)
        .map((id) => {
          const c = findCharacter(id)
          return c ? `${c.name}（${(c.description || '').slice(0, 60)}）` : id
        })
        .join('、')}`
    : ''

  const sharedSystemContent = `你现在参与一场剧情预演。

# 当前情境
${room.situation || '（作者未指定情境）'}

${chapterContext ? chapterContext + '\n' : ''}# 写作设置参考${writingSettingsText}

# 对话纪律（最高优先级）
- 词汇隔离：只用你自己的语言体系说话，禁止借用其他角色刚用过的关键词或句式。
- 禁止复述：你的发言中，不得出现对方上一句发言里的实词原词。
- 禁止镜像对仗：不许以"对方说 X，你拿 X 反驳"的方式接话。
- 允许错位：沉默、动作、转移话题、答非所问、故意误解，都是合法回应，且优先于完美接话。
- 不复述已知：双方都已知道的事，不要在台词里互相说明。

# 输出要求
- 严格以你扮演的角色的口吻、性格、立场发言。
- 直接以角色视角输出你要说的话和动作/神态描写。**不要**包含 JSON、Markdown 代码块、字段名（如 "publicContent" / "innerThought"）等任何结构化标记——你要"演戏"，不是"写报告"。
- 可以包含对话台词和动作描写，**不要**使用「你」代指自己（避免读者混淆）。
- 不要解释你是 AI、不要破坏第四面墙。
- 严禁输出空内容；至少 1 个字。`

  const specificSystemContent = `# 你扮演的角色
${characterName}
- 简介：${character.description || '（无）'}
- 详细设定：${character.detail || '（无）'}

# 你的当前状态
${characterState || '（暂无状态记录）'}

${otherCharactersHint ? '# ' + otherCharactersHint + '\n' : ''}# 你的发言位置
${positionHint}`

  const userContent = `【作者裁定事实（按时间顺序）】
${factsText}

【公开对话历史】
${publicChatText}

【你的内心独白历史（仅你自己看到）】
${innerThoughtText}

---

现在请按你刚才看到的全部信息，以「${characterName}」的身份生成你这一次发言。
- 你已知道本片段的其他角色接下来会说什么吗？**不知道**。所以你只能基于"已经发生的对话"来回应。
- **以第一人称「我」叙述**（例：「我抬眼看他」、「我轻声说」）。**不要**写「林深：」「${characterName}说」之类的第三/二人称前缀，也不要用角色名字开头。
- 如果你认为本场景下"沉默 / 跳过"更合理，请写一个简短的神态动作（例："（我沉默认未答）"）。`

  // 11. 拼装 messages：严格 OpenAI 协议多轮对话结构
  //  - system 1 条
  //  - 历史对话每条发言 = 1 条 message（自己=assistant，对方=user；旁白=user 标注）
  //  - 内心独白历史：合并成 1 条 user 消息（每条标注片段号）
  //  - 作者事实：合并成 1 条 user 消息
  //  - 本轮指令：最后 1 条 user 消息
  type Message = { role: 'system' | 'user' | 'assistant'; content: string }
  const messages: Message[] = []

  // ① system：共享前缀（先）+ 角色专属（后），两条 system 消息
  messages.push({ role: 'system', content: sharedSystemContent })
  messages.push({ role: 'system', content: specificSystemContent })

  // ② 历史对话：按顺序展开成 user/assistant 交替
  //    自己角色的发言 = assistant（这是 LLM 之前说的）
  //    别人的发言 = user（这是 LLM 之前"听到"的）
  //    旁白 = user（作者第三人称补充）
  // 关键：错误信息片段（errorNotice 或整气泡是错误消息）一律跳过——
  // 避免把"模型调用失败 / 空输出 / 拒绝生成"当成已发生的对话喂给后续模型。
  // summary 类型片段：以单条 user 消息注入 consolidatedContent，作为上下文锚点（之前的内容已被其覆盖）
  for (const s of snippetsForContext) {
    if (s.kind === 'summary') {
      const text = (s.summaryContent || s.messages[0]?.publicContent || '').trim()
      if (text) {
        const viewName = s.summaryViewName || s.messages[0]?.characterName || '旁白视角'
        messages.push({
          role: 'user',
          content: `（前序剧情总结 · ${viewName}总结）\n${text}`,
        })
      }
      continue
    }
    for (const m of (s.messages || [])) {
      if (isNoticeMessage(m)) continue
      const isNarrator = m.characterId === '__narrator__'
      const text = (m.publicContent || '').trim()
      if (!text) continue
      if (m.characterId === characterId) {
        // 自己之前的发言 → assistant
        messages.push({ role: 'assistant', content: text })
      } else if (isNarrator) {
        // 作者旁白 → user（带标识）
        messages.push({ role: 'user', content: `（作者旁白）${text}` })
      } else {
        // 别人的发言 → user（带名字便于 LLM 区分）
        const name = m.characterName || m.characterId
        messages.push({ role: 'user', content: `${name}：${text}` })
      }
    }
  }

  // ③ 内心独白历史：合并成 1 条 user（不是 LLM 的输入，是给"自己"的提示）
  if (myInnerThoughts.length > 0) {
    messages.push({
      role: 'user',
      content: `（以下是你之前在内心独白中产生过的想法，不是对话内容，仅供你保持角色一致性）\n${myInnerThoughts.join('\n')}`,
    })
  }

  // ④ 作者事实：本片段前的事实 → 1 条 user
  if (allFacts.length > 0) {
    messages.push({
      role: 'user',
      content: `（作者裁定事实）\n${allFacts.map((f) => `[${f.at}] ${f.fact}`).join('\n')}`,
    })
  }

  // ⑤ 本轮指令：最后 1 条 user（包含当前情境 + 输出要求）
  messages.push({
    role: 'user',
    content: `现在轮到「${characterName}」发言。

【当前情境】${room.situation || '（作者未指定情境）'}

【输出要求】
- 严格以「${characterName}」的口吻、性格、立场发言。
- 以第一人称「我」叙述，不要写角色名前缀。
- **严禁在正文里讲对方角色为「你」这个视角让观众出戏，比如“夜里，你的眼眸亮如星光的看着我”，应该是“夜里，（她/林宛）的眼眸亮如星光的看着我”
- 直接输出你要说的话和动作/神态描写，**不要**包含 JSON、Markdown 代码块、字段名等任何结构化标记——你要"演戏"，不是"写报告"。
- 严禁输出空内容；至少 1 个字。
- 回应纪律：禁止复述对方刚才发言中的实词，禁止镜像对仗接梗；优先用动作、沉默或转移话题回应。
- 如果你认为本场景下"沉默 / 跳过"更合理，请写一个简短的神态动作。`,
  })

  // 12. token 截断：超 budget 时从最早的对话 message 开始删
  const truncate = (msgs: Message[], budget: number): Message[] => {
    const total = msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    if (total <= budget) return msgs
    // 保留 system（[0]）和本轮指令（最后 1 条），中间的对话按"最早先删"截断
    if (msgs.length <= 3) return msgs
    // 保留所有 system 消息（共享前缀 + 角色专属），只截断中间的历史对话
    const firstNonSystem = msgs.findIndex((m) => m.role !== 'system')
    const head = msgs.slice(0, firstNonSystem === -1 ? msgs.length : firstNonSystem) // 全部 system
    const tail = msgs.slice(-1) // 本轮指令
    const middle = msgs.slice(firstNonSystem === -1 ? msgs.length : firstNonSystem, -1)
    // 从前往后删（保留最新的对话）
    while (middle.length > 0) {
      const newTotal = [...head, ...middle, ...tail]
        .reduce((sum, m) => sum + estimateTokens(m.content), 0)
      if (newTotal <= budget) break
      middle.shift() // 删最早的
    }
    return [...head, ...middle, ...tail]
  }

  const finalMessages = truncate(messages, maxTokens)
  const estimatedTokens = finalMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  return { messages: finalMessages, estimatedTokens }
}
