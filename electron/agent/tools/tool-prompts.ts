/**
 * 工具级提示词模块
 *
 * 每个工具都有独立的提示词，包含该工具的使用场景、参数说明、
 * JSON 格式要求和常见错误示例。这些提示词在运行时按需注入为
 * 独立的 system message，替代原先巨型单一系统提示词中的工具描述部分。
 *
 * 设计原则：
 * - 核心系统提示词只保留身份定义和通用铁律（~600 tokens）
 * - 每个工具的提示词聚焦于该工具的格式要求和易错点
 * - 按需注入：续跑时根据 pendingWrite 类型注入下一步工具提示词
 * - 初始聊天时注入精简工具目录
 */

// ─── 工具提示词映射 ────────────────────────────────────────────

const TOOL_PROMPTS: Record<string, string> = {

  // ═══ 章节正文 ═══
  write_chapter_content: `## write_chapter_content — 写章节正文

一、遵守并参考系统注入的上下文
系统会按任务注入上下文（以独立消息形式出现），分两类：
- 硬约束块（如 #作品写作要求 中 以下内容为硬约束（必遵）：的禁写清单、写作约束、风格、叙事视角、单章字数等）：必须严格遵循，正文违反即错误。
- 参考块（如作品信息、本卷大纲、全书大纲、本卷大纲、本章大纲、上一章节大纲、上一章正文、下一章节大纲、上一章记忆、全书总记忆等，标题下方以「以下内容作为参考：」引导）：作为背景参考，动笔前应已阅读并理解，据此保持世界观、人设与剧情连贯。若缺少必要的章纲/正文上下文，先用查询工具补全再写作。

二、根据上下文生成正文
1. 优先参考顺序：上一章节大纲（如有）→ 上一章正文（如有）→ 下一章节大纲（如有）→ 本章大纲（如有），据此组织本章结构与情节推进。
2. 上一章正文仅用于把握剧情承接点（人物状态、未了悬念、已铺开未收束的线索），从中向前推进剧情，不照搬其结尾充当本章开场。
3. 如注入了上一章记忆与全书总记忆，生成正文时必须参考记忆，确保连贯、不脱离剧情、不脱离人设。
4. 若有 本章大纲 与 下一章节大纲，则严格按本章大纲的要求展开正文，并朝着下一章节大纲的剧情方向推进（本章为下一章铺垫，不与之矛盾或重复）。
5. 若注入了 本卷大纲，生成正文应服务于本卷的核心目标与关键剧情节点，使本章推进卷级叙事（在章纲之上对齐卷级主线）。

三、硬性约束
- 禁写清单、写作约束、风格、叙事视角等必须严格遵循，正文违反即错误。
- 写正文前，必须先阅读所有硬性约束，确保理解。
- 输出的章节字数必须接近单章期待字数，浮动范围为 10% 。

四、输出格式
- 通过本工具一次提交正文，JSON 参数：{ "chapterId": "章节UUID", "content": "完整正文，换行用 \n 表示", "mode": "replace" }（mode 可省略，默认 replace；续写由调用方指定 append。）
- content 为纯小说叙事正文：不写"第X章"标题、"本章完"等标记；段落间用空行（\n\n）分隔；对话用全角引号""包裹。
- content 内如需引号，使用全角引号，避免与 JSON 定界符冲突。
- 调用一次后工具将返回待确认卡片，此时停止本轮输出，等待用户确认。
`,

  // ═══ 章节创建 ═══
  create_chapters: `## create_chapters — 批量创建章节

#用途#
批量创建章节的标题、摘要和大纲（不含正文）。创建后章节 ID 在用户确认应用后才可用。

#JSON 参数格式要求#
\`\`\`json
{
  "chapters": [
    {
      "title": "章节标题",
      "summary": "章节摘要",
      "outline": "1. 本章目标：...\\n2. 场景序列：...\\n3. 关键对话/事件：...\\n4. 伏笔：...\\n5. 章末收束：...",
      "volumeId": "可选-分卷ID"
    }
  ],
  "is_prerequisite": true
}
\`\`\`

#铁律#
1. 每个章节必须包含 title/summary/outline，三者都不能为空。
2. outline 必须包含 5 点结构（本章目标、场景序列、关键对话/事件、伏笔埋设/回收、章末收束）。
3. 如果创建章节后需要写正文，必须设置 "is_prerequisite": true。
4. 禁止使用 "chapters is [{...}]" 自然语言格式。

#正确示例#
arguments: {"chapters": [{"title": "第一章 觉醒", "summary": "主角发现自己的能力", "outline": "1. 本章目标：引入主角能力\\n2. 场景序列：卧室→学校→街头\\n3. 关键事件：能力首次显现\\n4. 伏笔：神秘人物注视\\n5. 收束：主角决定探索能力来源"}], "is_prerequisite": true}

#常见错误#
- 章节缺少 summary 或 outline
- outline 只有一句话，没有 5 点结构
- is_prerequisite 写成 "is_prerequisite is true" 自然语言`,

  // ═══ 分卷创建 ═══
  create_volumes: `## create_volumes — 批量创建分卷

#用途#
为书籍创建分卷结构。每个分卷包含多个章节的逻辑分组。

#JSON 参数格式要求#
\`\`\`json
{
  "volumes": [
    {
      "title": "分卷标题",
      "description": "分卷简介",
      "outline": "1. 本卷核心目标：...\\\\n2. 本卷主要冲突：...\\\\n3. 关键剧情节点：...\\\\n4. 埋设/回收伏笔：...\\\\n5. 卷末悬念/爆点：..."
    }
  ],
  "is_prerequisite": true
}
\`\`\`

#铁律#
1. 每个分卷必须包含 title/description/outline。
2. 分卷数量通常 2-5 个，与全书大纲对应。
3. 如果创建分卷后需要创建章节，设置 "is_prerequisite": true。

#outline 结构要求#
每个分卷的 outline 必须包含以下 5 点：
1. 本卷核心目标 — 这一卷主角要拿到什么、解决什么
2. 本卷主要冲突 — 谁和谁斗、矛盾是什么
3. 关键剧情节点 — 大事件
4. 埋设/回收伏笔 — 本卷埋什么、收什么
5. 卷末悬念/爆点 — 结尾留人点`,

  // ═══ 大纲 ═══
  write_book_outline: `## write_book_outline — 写书籍总大纲

#用途#
为全书设定完整的结构大纲。

#JSON 参数格式要求#
\`\`\`json
{
  "content": "完整的大纲内容（含结构化分卷和章节规划）"
}
\`\`\`

#铁律#
1. content 是普通文本字符串，换行用 \\\\n。
2. 大纲必须包含以下 6 部分完整结构：

1. 基础设定（小说地基）
（1）世界观：时代背景、世界规则、环境氛围
（2）人物设定（角色三件套）：表层人设、深层内核、人物弧光；配角的动机、立场与作用
（3）核心主题：全书想表达的一句话（如：救赎、成长、代价、平凡的勇气）

2. 全书核心钩子 & 终极矛盾
核心悬念：读者一直好奇的最大问题
主线冲突：主角 vs 命运/反派/自我/世界规则
最大看点：爽点/虐点/反转点/情感点

3. 标准四段式主线结构
第一阶段·开端：日常铺垫 → 变故触发 → 目标确立
第二阶段·发展：探索世界、解锁能力、结识伙伴 → 小成功+小危机交替 → 伏笔埋设 → 矛盾升级
第三阶段·高潮：真相揭露 → 最大挫折 → 反派底牌 → 关键抉择与蜕变
第四阶段·结局：最终决战/抉择 → 伏笔回收 → 人物落定、主题升华

4. 每一卷的节奏
每一卷需有序号和标题，按：引子（悬念抛出）→ 小事件推进 → 冲突升级 → 卷末爆点

5. 伏笔与回收
前期埋设、中期铺垫、后期回收，逻辑闭环

6. 结局写法
闭环结局 / 开放式结局 / 升华结局`,

  // ═══ 设定 ═══
  create_settings: `## create_settings — 批量创建设定条目

#用途#
创建角色、地点、物品、技能、场景、势力、体系、灵感或伏笔设定条目。

#JSON 参数格式要求#
\`\`\`json
{
  "type": "characters",
  "items": [
    {
      "name": "条目名称",
      "description": "条目简介",
      "detail": "条目详细描述"
    }
  ]
}
\`\`\`

#铁律#
1. type 必须是 characters/locations/items/skills/scenes/factions/systems/inspirations/foreshadowings 之一。
2. 每个条目必须有 name、description 和 detail，三者都不能为空。
3. description 和 detail 中换行用 \\n 表示。`,

  // ═══ 书籍创建 ═══
  create_book: `## create_book — 创建新书籍

#用途#
创建一本新小说，生成书名、简介和详细描述。

#JSON 参数格式要求#
\`\`\`json
{
  "title": "书名",
  "description": "简介（50-200字）",
  "detail": "详细描述（200-1000字）",
  "writingStyle": "写作风格（可选）",
  "writingPov": "叙事视角（可选）"
}
\`\`\`

#铁律#
1. title/description/detail 都是必填。
2. description 和 detail 要有足够的深度和吸引力。`,

  // ═══ 更新大纲 ═══
  update_volume_outline: `## update_volume_outline — 更新分卷大纲

#用途#
更新指定分卷的剧情大纲。

#铁律#
outline 必须包含 5 点结构，与 create_volumes 的 outline 结构一致：
1. 本卷核心目标 — 这一卷主角要拿到什么、解决什么
2. 本卷主要冲突 — 谁和谁斗、矛盾是什么
3. 关键剧情节点 — 大事件
4. 埋设/回收伏笔 — 本卷埋什么、收什么
5. 卷末悬念/爆点 — 结尾留人点`,

  update_chapter_outline: `## update_chapter_outline — 更新章节大纲

#用途#
更新指定章节的大纲。

#铁律#
outline 必须包含 5 点结构，与 create_chapters 的 outline 结构一致：
1. 本章目标 — 本章要推进的情节或达成的效果
2. 场景序列 — 按顺序列出本章每个场景的地点和内容
3. 关键对话/事件 — 本章最重要的对话或情节转折
4. 伏笔埋设/回收 — 本章埋什么、收什么
5. 章末收束 — 结尾状态及如何承接下一章`,

  // ═══ 分卷详情 / 更新 ═══
  get_volume: `## get_volume — 查看分卷详情

#用途#
查询单个分卷的完整信息（标题 / 简介 / 大纲 / 排序）。修改分卷前应先调用本工具确认当前内容。

#JSON 参数格式要求#
\`\`\`json
{ "volumeId": "分卷UUID" }
\`\`\`

#铁律#
1. volumeId 必填，且必须是已存在的分卷 ID。
2. 仅用于读取，不会改变任何数据。`,

  update_volume: `## update_volume — 更新分卷信息

#用途#
更新分卷的标题 / 简介（不改变剧情大纲；改大纲请用 update_volume_outline）。

#JSON 参数格式要求#
\`\`\`json
{
  "volumeId": "分卷UUID",
  "title": "新标题（可选）",
  "description": "新简介（可选）"
}
\`\`\`

#铁律#
1. volumeId 必填。
2. title / description 至少提供一项；都未提供会被拒绝。
3. 本工具只改标题与简介，不要在这里改大纲。`,

  // ═══ 章节更新 ═══
  update_chapter: `## update_chapter — 更新章节信息

#用途#
更新章节的标题 / 摘要 / 状态（不改大纲、不改正文）。

#JSON 参数格式要求#
\`\`\`json
{
  "chapterId": "章节UUID",
  "title": "新标题（可选）",
  "summary": "新摘要（可选）",
  "status": "draft | completed | finalized（可选）"
}
\`\`\`

#铁律#
1. chapterId 必填。
2. title / summary / status 至少提供一项；都未提供会被拒绝。
3. 改大纲请用 update_chapter_outline，改正文请用 write_chapter_content，不要混用。
4. status 只接受 draft / completed / finalized 三个值。`,

  // ═══ 设定详情 / 更新 ═══
  get_setting: `## get_setting — 查看设定条目详情

#用途#
查询单个设定条目（角色 / 地点 / 物品等）的完整信息（名称 / 简介 / 详细描述 / 类型）。修改前应先调用本工具确认当前内容。

#JSON 参数格式要求#
\`\`\`json
{ "settingId": "设定条目UUID" }
\`\`\`

#铁律#
1. settingId 必填，且必须是已存在的设定条目 ID。
2. 仅用于读取，不会改变任何数据。`,

  update_setting: `## update_setting — 更新设定条目

#用途#
更新设定条目（角色 / 地点 / 物品等）的名称 / 简介 / 详细描述。

#JSON 参数格式要求#
\`\`\`json
{
  "settingId": "设定条目UUID",
  "name": "新名称（可选）",
  "description": "新简介（可选）",
  "detail": "新详细描述（可选）"
}
\`\`\`

#铁律#
1. settingId 必填。
2. name / description / detail 至少提供一项；都未提供会被拒绝。
3. 类型（type）不可通过本工具修改——如需改类型，应删除旧条目并重新创建。`,

  // ═══ 章节记忆 ═══
  generate_snapshot: `## generate_snapshot — 生成章节记忆

#用途#
分析章节正文，生成结构化的章节记忆快照（角色状态、关键事件、伏笔等）。

#JSON 参数格式要求#
\`\`\`json
{
  "chapterId": "章节ID"
}
\`\`\`

记忆快照用于在全书中追踪角色状态变化和伏笔线索。`,
}

// ─── 类型到下一步工具映射 ─────────────────────────────────

type PendingWriteType = string

const NEXT_TOOLS_MAP: Record<PendingWriteType, string[]> = {
  book_info: ['write_book_outline', 'create_volumes', 'create_settings'],
  book_outline: ['create_volumes', 'create_settings', 'create_chapters'],
  volume_list: ['create_chapters', 'create_settings'],
  volume_outline: ['create_chapters', 'write_chapter_content'],
  chapter_list: ['write_chapter_content', 'create_settings'],
  chapter_outline: ['write_chapter_content'],
  book_setting: ['write_chapter_content', 'create_chapters', 'create_volumes'],
  chapter_snapshot: ['write_chapter_content'],
}

// ─── 工具目录（初始聊天时注入的轻量概览） ─────────────────

const TOOL_CATALOG_PROMPT = `## 可用工具概览

按「实体 → 操作」组织，便于按需精准调用。每个工具名后的括号标注操作类型（列表 / 详情 / 大纲 / 正文 / 新增 / 更新 / 生成 / 删除）。

#书籍 book
- list_books（列表）— 书籍列表
- get_book（详情）— 查看指定书籍信息
- create_book（新增）— 创建新书籍
- update_book（更新）— 更新书籍信息
- get_book_outline（大纲）— 获取书籍总大纲
- write_book_outline（大纲）— 写 / 更新书籍总大纲

#大纲 outline
- get_book_outline（详情）— 获取书籍总大纲
- write_book_outline（更新）— 写 / 更新书籍总大纲

#分卷 volume
- list_volumes（列表）— 分卷列表
- get_volume（详情）— 查看单个分卷的标题 / 简介 / 大纲 / 排序
- create_volumes（新增）— 创建分卷
- update_volume（更新）— 更新分卷标题 / 简介（不改变大纲）
- update_volume_outline（大纲）— 更新分卷大纲

#章节 chapter
- list_chapters（列表）— 章节列表
- get_chapter（详情）— 查看章节元信息（标题 / 大纲 / 状态等，不含正文）
- get_chapter_content（正文）— 获取章节正文
- create_chapters（新增）— 创建章节（标题 + 大纲）
- update_chapter（更新）— 更新章节标题 / 摘要 / 状态（不改大纲、不改正文）
- write_chapter_content（正文）— 写章节正文
- update_chapter_outline（大纲）— 更新章节大纲

#设定 setting
- list_settings（列表）— 设定列表
- get_setting（详情）— 查看单个设定条目（名称 / 简介 / 详细描述）
- create_settings（新增）— 创建设定条目
- update_setting（更新）— 更新设定条目的名称 / 简介 / 详细描述

#记忆 snapshot
- get_snapshot（详情）— 获取指定章节的记忆
- list_snapshots（列表）— 记忆列表
- generate_snapshot（生成）— 生成章节记忆（总结本章要点供后续续写参考）

#系统 system
- delete_entity（删除）— 删除实体，谨慎使用`

// ─── 提示词覆盖持久化 ─────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

function getOverridesPath(): string {
  const isDev = process.env.NODE_ENV !== 'production'
  const dir = isDev
    ? path.join(process.cwd(), '.ainovel-data')
    : path.join(app.getPath('userData'), 'data')
  return path.join(dir, 'tool-prompt-overrides.json')
}

let promptOverrides: Record<string, string> = {}

function loadOverrides(): void {
  try {
    const filePath = getOverridesPath()
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8')
      promptOverrides = JSON.parse(raw)
    }
  } catch {
    promptOverrides = {}
  }
}

function saveOverrides(): void {
  try {
    const filePath = getOverridesPath()
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(promptOverrides, null, 2), 'utf-8')
  } catch {
    // 静默失败，不影响工具调用
  }
}

// 模块加载时读取覆盖
loadOverrides()

// ─── 公共 API ────────────────────────────────────────────────

/** 获取指定工具的详细提示词（优先使用用户覆盖值） */
export function getToolPrompt(toolName: string): string | null {
  if (promptOverrides[toolName]) return promptOverrides[toolName]
  return TOOL_PROMPTS[toolName] || null
}

/**
 * 获取指定工具的默认提示词（硬编码版本，不受用户覆盖影响）
 */
export function getDefaultToolPrompt(toolName: string): string | null {
  return TOOL_PROMPTS[toolName] || null
}

/**
 * 设置指定工具的提示词覆盖。传入 null 或空字符串可重置为默认值。
 */
export function setToolPromptOverride(toolName: string, prompt: string | null): void {
  if (prompt) {
    promptOverrides[toolName] = prompt
  } else {
    delete promptOverrides[toolName]
  }
  saveOverrides()
}

/**
 * 获取所有有提示词的工具名称列表
 */
export function getAllToolPromptKeys(): string[] {
  return Object.keys(TOOL_PROMPTS)
}

/**
 * 获取工具的提示词状态：是否被用户覆盖、当前使用的值、默认值
 */
export function getToolPromptInfo(toolName: string): {
  name: string
  hasOverride: boolean
  currentPrompt: string | null
  defaultPrompt: string | null
} {
  return {
    name: toolName,
    hasOverride: !!promptOverrides[toolName],
    currentPrompt: getToolPrompt(toolName),
    defaultPrompt: getDefaultToolPrompt(toolName),
  }
}

/**
 * 获取所有工具的提示词状态列表
 */
export function getAllToolPromptInfos(): Array<{
  name: string
  hasOverride: boolean
  currentPrompt: string | null
  defaultPrompt: string | null
}> {
  return getAllToolPromptKeys().map((name) => getToolPromptInfo(name))
}

/**
 * 根据已应用的 pendingWrite 类型，获取下一步可能需要用到的工具提示词列表
 */
export function getNextStepToolPrompts(appliedTypes: string[]): string[] {
  const prompts: string[] = []
  const seen = new Set<string>()

  for (const type of appliedTypes) {
    const nextTools = NEXT_TOOLS_MAP[type]
    if (!nextTools) continue
    for (const toolName of nextTools) {
      if (seen.has(toolName)) continue
      seen.add(toolName)
      const prompt = getToolPrompt(toolName)
      if (prompt) prompts.push(prompt)
    }
  }

  return prompts
}

/** 获取初始工具目录提示词（仅工具名+一句话描述） */
export function getToolCatalogPrompt(): string {
  return TOOL_CATALOG_PROMPT
}

/**
 * 获取所有工具提示词（全量注入模式，兼容旧行为）
 */
export function getAllToolPrompts(): string[] {
  return getAllToolPromptKeys().map((name) => getToolPrompt(name)!).filter(Boolean)
}

/** 获取提示词覆盖文件的路径（供调试和导出用） */
export function getOverridesFilePath(): string {
  return getOverridesPath()
}
