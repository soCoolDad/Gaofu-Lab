/**
 * 聊天室上下文构建器
 *
 * 设计要点（与剧情预演不同）：
 *   - 聊天室里角色直接"说话"，不需要 publicContent/innerThought 的 JSON 结构，
 *     因此模型只输出纯文本台词 —— 这样真·逐字流式（stream:true）可以直接把
 *     delta 拼到气泡里，无需做流式 JSON 增量解析。
 *   - 为避免多角色连发时 OpenAI 协议里"连续同 role"的校验问题，整段历史被打包成
 *     一条带说话人标签的 user 消息（转录块），system 里交代人设与发言规则，
 *     模型以 assistant 身份只回自己这一句。
 */

import type { ChatRoomRole } from './types'
import { getActiveStyleSummary } from '../style'

/**
 * "结果提示"文案标记（与 chat-runner 中保持一致）。
 * 用于识别模型调用失败 / 空输出 / 拒绝生成 等"整气泡都是错误信息"的卡片内容，
 * 这类卡片只展示给用户看，不注入到后续角色的 prompt 上下文里。
 */
export const CHAT_EMPTY_RESULT_MARKER = '（模型返回为空，未生成台词）'
export const CHAT_ERROR_RESULT_PREFIX = '（模型调用失败：'
export const CHAT_REFUSED_RESULT_PREFIX = '（模型拒绝生成：'

/**
 * 判定卡片内容是否为"结果提示"（空 / 失败 / 拒绝）。
 * chat-runner 也用同一个判定（数据库里既有消息也走这里过滤），
 * 保证：失败卡片只展示给用户、不污染后续模型上下文。
 */
export function isChatResultNotice(content: string | null | undefined): boolean {
  if (!content) return false
  return content === CHAT_EMPTY_RESULT_MARKER
    || content.startsWith(CHAT_ERROR_RESULT_PREFIX)
    || content.startsWith(CHAT_REFUSED_RESULT_PREFIX)
}

export type ChatHistoryItem = {
  role: ChatRoomRole
  /** 角色消息时的说话人名字（用于转录块前缀） */
  characterName?: string | null
  content: string
  /**
   * 错误信息标记：true 表示这条历史消息是"被 content_filter / 中断拦截"的消息，
   * 注入到 prompt 时只保留 content（剧情部分），错误信息不进下个角色上下文。
   */
  hasErrorNotice?: boolean
}

/** 单个角色的记忆最后状态（用于注入上下文第一条系统消息） */
export type CharacterStateBrief = { name: string; stateText: string }

export type BuildChatContextArgs = {
  bookId?: string
  bookTitle: string
  characterName: string
  /** 角色设定文本（来自 bookSettingEntries.description + detail） */
  characterSetting: string
  /** 截至本角色发言前，房间里已有的全部消息（含本轮已生成的前序角色发言） */
  history: ChatHistoryItem[]
  /** 仅「当前发言角色自己」的记忆状态（取自定稿记忆）；不注入其他角色的状态，避免上帝视角 */
  selfState: CharacterStateBrief | null
  /** 在场角色名字列表（用于「群聊成员」系统消息，明确作者与哪些角色同群） */
  participantNames: string[]
  /** 当前角色与在场成员的关系文本（如 "- 李晓雯：爱恋"），无则 null —— 让角色对谁亲疏有别 */
  selfRelationships: string | null
  /** 系统聊天指示词（导演/用户给出的指令，注入为最后一条 user 消息） */
  instructionWord: string
}

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildChatContext(args: BuildChatContextArgs): { messages: LlmMessage[] } {
  const { bookId, bookTitle, characterName, characterSetting, history, selfState, participantNames, selfRelationships, instructionWord } = args

  // ── 角色专属 · 当前角色自己的状态（取自定稿记忆，仅本人可见） ──
  // 关键：只注入"说话者自己"的状态，绝不注入其他角色的私密状态（心境/线索/持有物/关系），
  // 否则角色会读到别人的心思，产生"上帝视角"。别人只能通过对话内容（公开）去了解。
  // 注意：本块是「角色专属」内容，组装时放在尾部（见下方 messages 组装），不破坏共享前缀缓存。
  const selfStateSystem = selfState
    ? [
      `# 你是「${characterName}」本人`,
      '- 现在你是一个真实、有血有肉的人，此刻正和群里其他人相处、对话。',
      `# 以下是你自己的当前状态：`,
      '',
      selfState.stateText,
    ].join('\n')
    : [
      `# 你是「${characterName}」本人`,
      '- 现在你是一个真实、有血有肉的人，此刻正和群里其他人相处、对话。',
    ].join('\n')

  // ── 第 3 条：系统 · 当前角色提示词（活成这个人） ──
  const characterPrompt = [
    '# 你该怎么说话，请严格遵守并理解以下的规则',
    '- 你们现在是通过电子设备在聊天群里聊天，不是面对面的在一起聊天。',
    '- 牢牢代入「你的当前状态」：那正是你此刻的心境、处境与说话风格。用你自己的脾气、情绪和习惯去反应，而不是客观描述或评判。',
    '- 要记住「你的当前状态」是你私密的事情，作为一个正常人，不要轻易说出自己当前的状态。',
    '- 你与在场每个人的亲疏态度见下方「与在场其他成员的关系」，请据此区别对待——对在意的人温柔、对仇人带刺、对陌生人客气，就像真人一样。',
    '- 群里的人只有「本群聊的成员」里列出的几位。无论你的记忆、状态或当前情境里是否存在其他人，在本聊天室里都禁止提及、称呼、讨论任何不在该列表里的具体人名、头衔或昵称（例如"王总"、"李经理"）。若必须涉及外部人物，请用"一个朋友"、"公司里的人"等模糊代称，不得出现具体姓名/头衔。',
    '- 只说出你这一刻真正会说的话。不要加 "角色名：" 前缀，不要整段用引号包裹；除非情境需要，不要写动作/神态旁白。',
    '- 绝对不要替别人说话，也不要总结、评论或复述整段对话。',
    '- 想说多少说多少：长短由此刻的情境和你这个人决定，不必凑字数，也不必刻意克制。',
    '- 会有正常人的小毛病：偶尔语序随意，少量口语缩写，不要句句逻辑严谨。',
    '- 可以跑题，可以敷衍，可以疑惑，可以杠两句，也可以附和，有情绪起伏。',
    '- 不要暴露自己是AI，不解释，不跳出人设。',
    '- 不要使用书面化措辞。',
    '- 记住，当前是聊天室，你只能与「本群聊的成员」进行聊天。不要出现与群里无关的人员的话语、名字、头衔或任何指代；不要替不在场的人发言，也不要让不在场的人成为话题中心。',
    '- 你要记得自己的身份，不要超出聊天情景边界，不要出现与聊天无关的事。',
    '- 严禁主动暴露你自己的当前状态所提及的状态以及相关人物、地点、场景等。'
  ].join('\n')

  // ── 第 2.5 条：系统 · 当前角色与在场成员的关系 ──
  // 让角色对谁亲疏有别（数据来自 book_memory 当前角色的关系，已过滤到在场成员）。
  const relationshipSystem = selfRelationships
    ? [
      '# 与在场其他成员的关系（请据此带着亲疏、态度去对待每个人）：',
      '',
      selfRelationships,
    ].join('\n')
    : null

  // ── 第 2 条：系统 · 群聊成员（在场角色 + 作者） ──
  // 让模型明确"群里都有谁"——作者作为明确成员出现（平等参与者，非更高权威）。
  const memberLines = [
    ...participantNames.map((n) => `- ${n}`),
    '- 作者（群里与你实时对话的一名参与者）',
  ]
  const membersSystem = [
    '# 本群聊的成员：',
    '（以下是你能直接对话、称呼、或提及的全部对象。除了这个列表里的人，严禁出现任何其他人名、头衔、昵称或指代。）',
    '',
    ...memberLines,
  ].join('\n')

  // 说话人标签（用于当前聊天信息块前缀）
  const speakerLabel = (h: ChatHistoryItem): string => {
    if (h.role === 'director') return '导演'
    if (h.role === 'author') return '作者'
    if (h.role === 'netizen') return '网友'
    if (h.role === 'character') return h.characterName || '某角色'
    return '系统'
  }

  // ── 聊天记录转录块（作为「一条 user 消息」，而非 system）──
  // 关键修复：聊天内容属于"对话"，应按对话语义给 user 角色，用「说话人：内容」标签呈现；
  // 放在 system 里会被模型当成"指令/命令"去遵循，产生混淆与跑偏。改为单条 user 转录块既符合
  // 语义，也让这段共享历史成为前缀缓存的稳定块（同回合内所有角色读同一份对话，跨角色命中缓存）。
  // 关键原则：模型调用失败 / 空输出 / 拒绝生成 等"整气泡都是错误信息"的卡片只展示给用户看，
  // 不能注入到 prompt —— 避免后续角色把错误消息当成"已发生的事实"来回应。
  const transcriptLines = [
    '# 本群聊的聊天记录（按时间顺序，每条以「说话人：内容」呈现，均为已发生的事实）：',
    '',
    ...history
      .filter((h) => !isChatResultNotice(h.content))
      .map((h) => `[${speakerLabel(h)}]：${h.content}`),
    '',
    '# 现在轮到你，给你的指令',
    instructionWord,
  ]
  const transcriptMessage: LlmMessage = { role: 'user', content: transcriptLines.join('\n') }

  // ── 角色专属 · 当前角色的角色设定表（来自 bookSettingEntries.description + detail）──
  // 关键：这是角色自己的公开人设档案（姓名/外貌/性格/背景/说话风格等），角色理应知道自己是谁，
  // 与"他人私密状态"是两回事——注入设定表绝不违反"禁止上帝视角"铁律（那是指不能读别人的私密状态）。
  // 之前漏注入设定表，导致角色只知道"当前状态"、却不知道自己的完整人设，容易 OOC（出戏）/ 丢失背景设定。
  const characterSettingSystem = (characterSetting || '').trim()
    ? [
      '# 你的角色设定（你的人设档案，请始终代入这个身份说话）：',
      '',
      (characterSetting || '').trim(),
    ].join('\n')
    : null

  // ── 组装顺序（缓存优先）──
  // 先把「与具体角色无关、跨角色/跨轮次稳定」的共享内容放最前，形成可命中前缀缓存的共享前缀；
  // 再把「仅当前角色专属」的内容推到尾部，避免角色专属内容打散共享前缀。
  //   共享前缀（位置 0..2，同一回合内所有角色完全相同 → 前缀缓存命中）：
  //     1) 群聊成员（在场名单，房间级稳定）
  //     2) 角色说话规则（how-to-speak，完全与角色无关）
  //     3) 聊天记录转录块（user，同一房间同一回合内所有角色共享同一份对话，往往占用 token 大头）
  //   角色专属尾部（位置 3 起，每个角色不同，但不影响上面的共享前缀缓存）：
  //     4) 当前角色的角色设定表（人设档案，来自 bookSettingEntries，之前漏注入已于本次修复）
  //     5) 当前角色自己的状态
  //     6) 当前角色与在场成员的关系
  // 文风指纹注入（书籍级，跨角色共享，放在共享前缀内，命中前缀缓存）
  const styleSummary = bookId ? getActiveStyleSummary(bookId) : null
  const styleSystem = styleSummary
    ? `# 文风指纹（必遵，逐条遵守）\n${styleSummary}`
    : null

  const messages: LlmMessage[] = [
    { role: 'system', content: membersSystem },
    { role: 'system', content: characterPrompt },
  ]
  if (styleSystem) messages.push({ role: 'system', content: styleSystem })

  // 「你与在场成员的关系」放在角色专属尾部（角色提示词里已改为"见下方"引用），且排在当前角色状态之后。
  // 角色专属尾部顺序：① 角色设定表（人设档案）→ ② 当前角色自己的状态 → ③ 与在场成员的关系，
  // 让模型先建立"你是谁"，再了解"当下处境"，最后知道"对谁亲疏有别"。
  if (characterSettingSystem) messages.push({ role: 'system', content: characterSettingSystem })
  messages.push({ role: 'system', content: selfStateSystem })
  if (relationshipSystem) messages.push({ role: 'system', content: relationshipSystem })

  //添加历史消息以及指令
  messages.push(transcriptMessage)


  return { messages }
}

/**
 * 轻量清洗模型输出：
 *   - 去掉可能出现的 "角色名：" / "角色名：" 前缀（部分模型仍会带）
 *   - 去掉整段包裹的代码块 / 引号
 *   - 去掉首尾空白
 */
export function cleanCharacterLine(raw: string, characterName: string): string {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
  }
  // 去除形如 "名字：" / "名字:" / "名字： " 的开头
  const prefix = new RegExp(`^\\s*${escapeRegExp(characterName)}\\s*[:：]\\s*`)
  text = text.replace(prefix, '')
  // 去除整段被引号包裹
  if (
    (text.startsWith('“') && text.endsWith('”')) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('『') && text.endsWith('』')) ||
    (text.startsWith('「') && text.endsWith('」'))
  ) {
    text = text.slice(1, -1).trim()
  }
  return text.trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
