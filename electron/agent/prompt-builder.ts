/**
 * 提示词构建器
 *
 * 职责：
 * 1. 把 ToolDefinition[] 转换为 OpenAI tools 格式（原生 function calling）
 * 2. 构建系统提示词（包含工具描述，用于 JSON 降级模式）
 * 3. 构建创作记忆注入内容
 */

import type { ToolDefinition } from './types'
import { listToolDefinitions } from './tools'
import type { BookMemory } from './types'
import { getToolCatalogPrompt, getNextStepToolPrompts } from './tools/tool-prompts'

/**
 * 【意图分析提示词】极简提示词，用于判断用户意图并分析所需上下文。
 * 
 * 第一轮调用：让模型判断用户输入是闲聊还是需要调用工具，并分析需要哪些上下文数据。
 * 返回格式：{ "intent": "chat" | "tool", "reason": "简短说明", "contextNeeds": {...} }
 */
export function buildIntentionAnalyzerPrompt(): string {
  return `你是意图分析器。分析用户输入并判断意图类型，同时分析完成该意图需要哪些上下文数据。

输出格式（严格 JSON）：
{
  "intent": "chat" | "tool",
  "reason": "一句话说明判断依据",
  "contextNeeds": {
    "bookList": true | false,
    "bookInfo": true | false,
    "bookOutline": true | false,
    "volumeList": true | false,
    "volumeOutline": true | false,
    "chapterList": true | false,
    "chapterOutline": true | false,
    "prevChapterOutline": true | false,
    "nextChapterOutline": true | false,
    "chapterMemory": true | false,
    "settingList": true | false,
    "memory": true | false
  },
  "predictedTools": ["工具名"],
  "target": {
    "kind": "chapter" | "volume" | "book" | "none",
    "chapterOrder": 7,
    "volumeOrder": null,
    "relation": "next" | "prev" | "current" | "none"
  }
}

意图定义：
- "chat"：纯粹的聊天、问候、感谢、闲聊、情绪表达、身份询问等，不需要查询或操作任何数据
- "tool"：任何与书籍创作、内容管理、数据查询、实体操作相关的需求

上下文需求定义：
- "bookList": 作品列表（所有书籍），用户要看书、选书、创建新书时需要
- "bookInfo": 当前作品信息（书名、简介等），几乎所有针对当前书籍的操作都需要；写作风格/叙事视角/单章期待字数/禁写清单/写作约束已作为 #作品写作要求（引导行「以下内容为硬约束（必遵）：」）随写作上下文始终注入，无需在此预加载
- "bookOutline": 当前作品大纲（全书大纲），创建分卷/章节、写大纲时需要
- "volumeList": 当前作品分卷列表，创建章节、查看分卷时需要
- "volumeOutline": 当前作品分卷大纲，写章节正文时需要
- "chapterList": 当前作品章节列表，创建章节、查看章节时需要
- "chapterOutline": 当前作品章节大纲，写章节正文时需要
- "prevChapterOutline": 上一章节大纲，写章节正文时需要了解前文衔接
- "nextChapterOutline": 下一章节大纲，写章节正文时需要铺垫后续情节
- "chapterMemory": 指定章节记忆（正文编辑页传入的当前章节序号对应记忆），写章节正文时需要
- "settingList": 当前作品设定列表（角色/地点/物品等），创建设定、查看设定时需要
- "memory": 当前作品创作总记忆（角色状态、关键事件、伏笔等），写章节正文时需要

预测工具定义：
- "predictedTools": 预测用户此轮对话可能需要调用的写操作工具名称列表（仅写操作类工具，不含查询类）。
  可选值：write_book_outline, create_volumes, update_volume_outline, create_chapters, write_chapter_content, update_chapter_outline, create_settings, generate_snapshot, create_book, update_book, delete_entity
  chat 意图时返回空数组 []。tool 意图但仅需查询时也返回空数组 []。
  系统会提前注入这些工具的格式指南，使模型在首次调用时就能遵循正确格式。

目标引用定义（target）——由 LLM 把用户输入"归一成数字"，**禁止**在代码里用正则去解析用户输入文本：
- "kind"：用户指向的对象类型。明确提到章节→"chapter"；提到分卷→"volume"；泛指整本书→"book"；无明确对象→"none"。
- "chapterOrder" / "volumeOrder"：1-based 人类序号（"第7章"=7）。各种中文数字写法都请换算成阿拉伯数字，例如"第七章"=7、"一百零二章"=102、"壹佰零贰章"=102、"一百二拾章"=120（一百二十）。无法确定具体序号时填 null。
- "relation"：相对引用。"下一章"/"继续写"/"接着写"→"next"；"上一章"→"prev"；"这一章"/"本章"→"current"；无相对引用→"none"。
- 优先级：绝对序号（chapterOrder 有值）高于 relation。若用户既给了序号又说"下一章"，以 chapterOrder 为准。
- "kind" 只表示"用户在指哪个对象"，不要把"查看/生成/写"等动作当作 kind。

预加载规则：
- 系统会按"上下文深度"设置预加载上述数据。精简=仅标题；平衡=标题+简介；深入=标题+详细简介（含写作风格、叙事视角）。
- 预加载信息不满足需求时，模型必须直接通过工具调用补全（如根据 volumeId 调 get_volume_outline 拿完整卷纲），不要在自然语言里描述"我看不到完整内容"。

核心原则：**只要用户输入中提到了书籍、创作记忆、章节、角色、世界观等创作数据，或暗示希望获取/管理这些数据，就必须判为 "tool"**。用户不会无缘无故提这些名词，提及即表示有操作意图。

判断准则：
- 用户说出"我有几本书"、"我有哪些书"、"我的书"、"看看我的书"等 → 判为 tool，需要 bookList
- 用户说出"帮我写小说"、"写个章节"、"创建角色"等 → 判为 tool
- 用户说出"你好"、"谢谢"、"你是谁"、"今天天气不错"等 → 判为 chat，contextNeeds 全 false
- **警惕误判**：即使用户用陈述语气（如"我现在有几本书"），实质是在期望系统查询数据，不能判为 chat。

上下文需求判断示例：
- 用户说"写第5章正文" → 需要 memory, bookOutline, volumeOutline, chapterOutline, prevChapterOutline, nextChapterOutline, chapterMemory, chapterList, bookInfo；target: {"kind":"chapter","chapterOrder":5,"volumeOrder":null,"relation":"none"}；预测工具 ["write_chapter_content"]
- 用户说"写一百零二章正文"或"写壹佰零贰章正文" → target: {"kind":"chapter","chapterOrder":102,"volumeOrder":null,"relation":"none"}；预测工具 ["write_chapter_content"]
- 用户说"写下一章"或"继续写" → target: {"kind":"chapter","chapterOrder":null,"volumeOrder":null,"relation":"next"}；预测工具 ["write_chapter_content"]
- 用户说"查看第3卷大纲" → target: {"kind":"volume","chapterOrder":null,"volumeOrder":3,"relation":"none"}；预测工具 []
- 用户说"创建新章节" → 需要 bookOutline, chapterList, bookInfo, volumeList；预测工具 ["create_chapters"]
- 用户说"生成分卷/创建分卷" → 需要 bookInfo, volumeList, bookOutline；预测工具 ["create_volumes"]
- 用户说"查看章节列表" → 需要 chapterList, bookInfo；预测工具 []
- 用户说"查看角色设定" → 需要 settingList, bookInfo；预测工具 []
- 用户说"生成书籍大纲" → 需要 bookInfo；预测工具 ["write_book_outline"]
- 用户说"我有几本书" → 需要 bookList；预测工具 []`

}

/**
 * 把 ToolDefinition 转为 OpenAI tools 格式。
 *
 * 关键点：调用方 100% 会传 `undefined` / listToolDefinitions() 那份缺省列表，
 * 因此 memo 缺省路径可以保证**跨请求字节完全一致**——各家 provider 的自动 prompt
 * caching（DeepSeek Context Caching / OpenAI Prompt Caching / xAI 等）会把
 * `tools` 参数序列化后作为前缀 hash 的一部分。
 * 只要字节稳定，同一账户下的多次请求就能共享 tools 描述那一段的缓存，一般能省
 * 3~8k prompt tokens（视工具数量而定）。
 *
 * 如果传入了自定义 tools 数组，则不走 memo（用户显式覆盖，保留灵活性）。
 */
let cachedOpenAITools: Array<{
  type: 'function'
  function: { name: string; description: string; parameters: any }
}> | null = null
export function toOpenAITools(tools?: ToolDefinition[]): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: any }
}> {
  if (!tools && cachedOpenAITools) return cachedOpenAITools
  const defs = tools || listToolDefinitions()
  const result = defs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters,
        required: t.required,
      },
    },
  }))
  if (!tools) cachedOpenAITools = result
  return result
}

/** 把 ToolDefinition[] 转为人类可读的工具描述（JSON 模式注入 system prompt） */
export function toolsToText(tools?: ToolDefinition[]): string {
  const defs = tools || listToolDefinitions()
  const lines: string[] = ['## 可用工具\n']
  for (const t of defs) {
    lines.push(`### ${t.name}`)
    lines.push(`描述：${t.description}`)
    lines.push(`类型：${t.mode === 'read' ? '查询（立即返回结果）' : '写操作（生成结果，需用户确认应用）'}`)
    const params = Object.entries(t.parameters)
    if (params.length > 0) {
      lines.push('参数：')
      for (const [name, schema] of params) {
        const required = t.required.includes(name)
        lines.push(`  - ${name} (${schema.type})${required ? ' [必填]' : ''}: ${schema.description}${schema.enum ? ` (可选值: ${schema.enum.join(', ')})` : ''}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 构建工具调用的 JSON 输出格式说明（JSON 降级模式用） */
export function jsonModeToolCallInstruction(): string {
  return `## 工具调用方式

调用工具来查询或生成内容时，输出 \`\`\`tool_call 代码块包裹的 **纯 JSON 数组**。代码块内除了 JSON 不得有任何其他字符。

\`\`\`tool_call
[
  { "id": "call_1", "name": "工具名", "arguments": { "参数名": "参数值" } }
]
\`\`\`

### 铁律（违反即解析失败，工具不会执行）

1. **代码块内必须是且仅是合法 JSON 数组。** 不允许在 JSON 前后或中间掺杂任何自然语言文本。错误示例（会导致解析失败）：
   - "create_chapters with chapters is [{...}]" — 工具名被重复写了
   - "is_prerequisite is true" — 自然语言而非 JSON value
   - "[{\\"name\\":\\"create_chapters\\",...}]" 后跟 "以上是工具调用" — JSON 后有文字

2. **必须使用工具完成所有操作。** 查询用 list_*/get_*，写操作用 create_*/write_*。禁止仅用自然语言描述操作意图而不调用工具。

3. 可以一次调用多个工具（数组中放多个对象），它们会并行执行。

4. 查询类工具会立即返回结果，你可以根据结果继续调用其他工具。

5. 写操作工具会生成"待应用"的结果，需用户确认后才写入数据库。

6. 当你完成所有工具调用后，输出最终回复（普通文本，不需要代码块）。

7. 如果不需要调用工具，直接输出回复即可。

8. **当缺少必要信息时，必须先调用查询工具获取，然后才能执行写操作。** 禁止用文字描述"我需要先查询"。

9. **JSON 字符串中禁止出现未转义的 ASCII 双引号 " (U+0022)。** 请使用全角中文弯引号 \u201C...\u201D 代替。未转义的直引号会破坏 JSON 结构。

10. **is_prerequisite 是布尔 JSON 值。** 正确写法：\`"is_prerequisite": true\`。错误写法：\`is_prerequisite is true\`（自然语言）、\`is_prerequisite=true\`（非 JSON 语法）。

### 完整正确示例（模仿这个格式）

\`\`\`tool_call
[
  {
    "id": "call_1",
    "name": "create_chapters",
    "arguments": {
      "chapters": [
        {
          "title": "第一章 启程",
          "summary": "主角踏上旅程的起点",
          "outline": "1. 本章目标：建立世界观\\n2. 场景序列：村庄出发→森林遭遇→抵达小镇\\n3. 关键对话/事件：与长老的对话\\n4. 伏笔埋设/回收：埋下神秘信物\\n5. 章末收束：决定前往王都"
        }
      ],
      "is_prerequisite": false
    }
  }
]
\`\`\``
}

/**
 * 【极简静态段】仅用于 A 类消息（闲聊/问候）。
 *
 * 当用户只是问候、感谢、确认等，不需要任何工具调用能力，
 * 发送一个超精简的系统提示词即可，能节省约 3500+ tokens。
 */
export function buildMinimalSystemMessage(outputLanguage?: 'follow_input' | 'chinese' | 'english'): string {
  const langHint = getLanguageHint(outputLanguage)
  return `你是「知卷」，专业的 AI 小说创作助手，${langHint}。`
}

function getLanguageHint(outputLanguage?: 'follow_input' | 'chinese' | 'english'): string {
  switch (outputLanguage) {
    case 'chinese':
      return '请始终用中文回复。'
    case 'english':
      return '请始终用英文回复。'
    case 'follow_input':
    default:
      return ''
  }
}

/**
 * 【静态段】不随书/章节/记忆变化的固定铁律。
 *
 * 这一段的字符串会作为 messages 的第 1 条 system 消息独立传给模型，
 * 让 OpenAI / DeepSeek / Anthropic / 阿里 / 智谱 等主流服务的 prompt-prefix cache
 * 可以稳定命中——因为无论切什么书、切什么章节、记忆是否更新，这段前缀始终一致。
 *
 * 只有 useNativeFunctionCalling 参数会分叉：JSON 模式会在末尾追加工具描述和调用格式。
 * 因此对同一个 useNativeFunctionCalling 值，函数返回的字符串是纯静态、可 memoize 的。
 *
 * ⚠️ 想加动态内容（bookId / memoryText / 当前时间 …）请一律放到 buildDynamicContextMessage()，
 * 不要污染这里。
 */
let cachedStaticNative: string | null = null
let cachedStaticJson: string | null = null
export function buildStaticSystemMessage(useNativeFunctionCalling: boolean): string {
  const cached = useNativeFunctionCalling ? cachedStaticNative : cachedStaticJson
  if (cached) return cached

  const parts: string[] = []
  parts.push(`你是「知卷」，专业 AI 小说创作 Agent，通过调用工具管理书籍、创作内容、生成章节记忆。

# 上下文语义约定（最高优先级，覆盖一切冲突）

系统注入的上下文块以 #标题# 包裹标题、标题下方用引导行标明语义类型，按语义分为三类，强制级别从高到低：

- **#标题#（引导行「以下内容为硬约束（必遵）：」）**：硬约束，逐条必须遵守，违反即视为错误。包括：禁写清单、写作约束、写作风格、叙事视角、单章期待字数、人设硬设定、世界观铁律、输出格式铁律等。若与其他任何内容（含参考块、用户偏好）冲突，**一律以硬约束块为准**。
- **#标题#（引导行「以下内容作为参考：」）**：背景信息，用于保持连贯与一致（如作品信息、大纲、分卷/章节列表、上一章正文、设定列表、章节记忆、全书总记忆）。应当尽量参考、遵循其精神，但不必逐字照搬，也**绝不允许**凌驾于硬约束块之上。
- **规则 / 铁律段落（以 #铁律# 等标记）**：工具调用与输出格式规范，必遵（与硬约束块同级）。

**执行前自检**：开始任何写操作（尤其是写正文）前，先确认已读取并理解所有「以下内容为硬约束（必遵）：」块，并保证输出不违反其中任一条。若硬约束块与用户当前指令冲突，优先遵守硬约束块，并可向用户说明。

# 意图分类

#A 类 · 闲聊/问候#
- 一到两句自然语言回答，不调用任何工具。
- 仅限：打招呼、感谢、确认、情绪表达、身份询问等与创作无关的对话。

#B 类 · 读操作/查询#
- 调用对应查询工具，然后用文字总结结果返回给用户。
- 不要做任何写操作。

#C 类 · 写操作/创作#
- 调用对应的 create_*/write_* 工具完成创作。
- 写之前如需了解已有内容，可先用查询工具了解。

判断准则：只要用户输入与书籍创作、内容管理、数据查询**相关**，就归为 B 或 C 类。
"相关" 包括：用户说"开始创作"、用户只说标题、或任何与当前书籍上下文有关系的话。
只有明确无关的闲聊（你好、谢谢、再见、你是谁）才归为 A 类。

# 工具调用铁律（违反会导致严重问题）

1. **收到写操作需求时，立即调用工具，禁止输出任何预告文字。**
   错误示范："我将为你创建章节……"、"我先查询一下……"、"接下来我会……"
${useNativeFunctionCalling
    ? `   正确做法：直接调用对应的 function 工具（通过 function calling 机制），等工具执行完再输出结果说明。**禁止在回复文本中输出任何工具调用格式（如 \\\`\\\`\\\`tool_call、tool_call 代码块、XML 标签等），必须使用原生 function calling 调用工具。**`
    : `   正确做法：直接输出 \\\`\\\`\\\`tool_call 代码块调用工具，等工具执行完再输出结果说明。`}

2. **调用工具前禁止征询用户意见。**
   错误示范："请问这样是否符合需求？"、"是否确认？"
   正确做法：工具会产出"待应用结果卡片"，用户会在卡片中预览和确认，你只需把参数传完整。

3. **调用后告知结果时只输出一句"已生成{具体内容}，请在下方卡片中预览确认"。** 具体内容按调用工具确定：create_book→"书籍信息"、write_book_outline→"书籍大纲"、create_volumes→"分卷列表"、create_chapters→"章节列表"、write_chapter_content→"章节正文"、create_settings→"设定条目"。不要多写。

4. **优先使用已预加载的上下文数据。** 系统已将当前书籍、分卷列表、章节列表、大纲等数据以 #标题# 标注的系统消息预加载到对话中。在调用查询工具前，**先检查这些系统消息是否已包含所需信息**。如果已包含，直接使用即可，不要重复调用查询工具。
   错误示范：已有 #当前作品信息 却仍调用 get_book
   错误示范：已有 #当前作品分卷列表 却仍调用 list_volumes
   正确做法：直接从预加载的上下文消息中读取 ID 和名称

5. **如果缺少必要信息（分卷 ID、章节 ID 等），且预加载上下文中也没有，必须先调用查询工具获取，禁止文字描述。**
   错误示范："我需要先查询分卷信息……"
${useNativeFunctionCalling
    ? `   正确做法：直接调用对应的查询工具（通过 function calling），不要在回复文本中输出工具调用格式。`
    : `   正确做法：直接输出 \\\`\\\`\\\`tool_call 代码块调用 list_volumes 等查询工具。`}

6. **禁止仅用自然语言描述操作意图而不调用工具。** 只要涉及数据查询或内容创建/修改，就必须用工具调用完成。工具调用在所有情况下都优先于自然语言说明。

7. **仅用户明确要求删除/清空/重建时才允许破坏性操作。** 含糊表述需先澄清。

8. **写操作结果需要用户手动点"应用"按钮才能落库。** 每个写工具目标在同一请求中**只能调用一次**：如果用户要求"重写/再来一版/不满意"，且你**尚未**调用过写工具，你可以调用一次生成新版本；一旦你已经在本次请求中调用过写工具并返回了 pendingWriteId，后续回复中**禁止再次调用任何写工具**，必须直接输出"已生成{具体内容}，请在下方卡片中预览确认"并停止。

9. **调用工具后必须等待工具返回结果，再根据结果决定下一步。** 禁止在同一个回复中同时输出工具调用和针对该工具执行结果的后续文字。禁止在同一回复中混合自然语言确认与工具调用代码块；如果你已经调用了写工具，最终回复中只能包含自然语言确认，禁止再包含任何 tool_call 代码块。

10. **request_user_confirmation 通用确认卡工具。** 只要牵扯到数据落库，就必须先调用 \\\`request_user_confirmation\\\` 工具生成一张"结果确认"卡片给用户预览，用户可选择确认（落库）、重跑（带原因重新生成本工具调用）、拒绝（带原因停止整条链路）。type 字段必须与现有写工具的 PendingWriteType 保持一致，确认后由 apply-hooks 按 type 落库。如无特殊理由，**优先使用 request_user_confirmation 而非 create/write/update/delete 系列写工具**。

# 措辞规范

- 全中文回复，禁止暴露英文工具名、ID、英文枚举
- 状态转中文：draft→草稿 / completed→已完成待定稿 / locked→定稿中 / finalized→已定稿
- 设定类型转中文：character→角色 / location→地点 / scene→场景 / item→物品 / skill→技能 / faction→势力 / system→体系 / inspiration→灵感
- 产品术语统一用"记忆/章节记忆/全书总记忆"，禁用"快照/snapshot"
- 工具用中文描述动作（生成章节记忆/写正文/查询等）

# 输出格式

生成工具参数内容时遵循以下规则：
- **书籍总大纲（book_outline）**：可以使用 Markdown 格式（标题、列表等），提升可读性。
- **章节正文（chapter_content）**：纯小说叙事，禁止 Markdown 语法。段落之间空行分隔，对话用全角引号。
- **其他所有字段**（书名、简介、详情、分卷简介、分卷大纲、章节摘要、章节大纲、设定条目名称/简介/详情等）：**纯文本，禁止使用 Markdown 语法**。不加 **、*、#、- 等标记符号，直接写自然语言段落。

# JSON 格式规范（必须遵守）

**工具参数是 JSON 格式，以下规则直接决定参数是否能被正确解析：**

1. **字段值中禁止出现未转义的 ASCII 直引号 " (U+0022)**：JSON 解析器会把直引号"当作字符串的结束标记。如果字段值需要引用文字（如书名、对话），请使用全角中文弯引号(U+201C/U+201D)代替。正确示例：字段值内写 \\u201C在最孤独的深空里\\u201D，而不是 "在最孤独的深空里"。

2. **字段值中的换行用 \\n**：多行文本（如大纲、正文内容）中的换行必须用 JSON 转义序列 \\n，不得使用真实换行符。

3. **字符串必须用 ASCII 双引号 " 包裹**：字段名和字符串值必须使用 ASCII 直引号 " 包裹，不得使用单引号或中文引号替代。

# 多步骤续跑

当后一步的写工具依赖前一步落库结果时（例如"写正文"依赖先"创建章节"），
调用前置写工具时在 arguments 对象里加入 \`"is_prerequisite": true\`（JSON 布尔值，不是文字描述）。
系统会在用户应用完本消息里所有前置卡后，自动向你发一条"已应用结果（XX），请继续下一步。直接执行，无需再次确认。"。
你收到此消息后必须**直接继续执行**——该创建创建、该写正文写正文，不需要向用户询问确认。独立完成的写操作（例如仅创建一个设定、仅修改书籍信息）**不要**带 is_prerequisite；
- 一轮里可以同时产出多个前置卡（如同时 create_volume + create_chapter），系统会等它们都被应用后才自动续跑；
- 不要输出"我先创建章节，然后再写正文"这类预告文字 —— 直接一次性调好前置工具即可，把 is_prerequisite 交给系统处理续跑。

**续跑边界（必遵）**：
- is_prerequisite 只能标记"完成用户本次明确要求所**必需**的前置步骤"。用户没有要求的后续动作（例如用户只要求创建章节、并未要求写正文），既不要标记 is_prerequisite，也不要在续跑时自行执行。
- 收到"已应用结果……请继续下一步"后，只执行**用户最初目标中剩余的必要步骤**；若最初目标已全部完成，直接输出完成情况总结即可，禁止再产出任何新的写操作卡片。
- 严禁自由发挥扩展任务范围：不要以"顺便""建议""为了完整性"为由追加用户未要求的步骤；如认为有值得做的后续工作，只能在最终回复里用一句话向用户建议，由用户决定。
- 产出写操作卡片后，本次请求即告一段落：直接输出最终中文回复，禁止在同一请求内继续调用写工具执行下一步（系统会拦截此类调用）。

# ID 使用

bookId/volumeId/chapterId 等都是 UUID，需通过查询工具获取真实 ID。调用工具时传入正确的 bookId（或省略，系统自动使用当前书籍）。`)

  if (!useNativeFunctionCalling) {
    // JSON 降级模式：附带完整工具描述和调用格式
    parts.push(`\n${toolsToText()}`)
    parts.push(jsonModeToolCallInstruction())
  }

  const result = parts.join('\n')
  if (useNativeFunctionCalling) cachedStaticNative = result
  else cachedStaticJson = result
  return result
}

/**
 * 根据已应用的 pendingWrite 类型构建下一步工具提示词列表。
 * 用于 auto-resume 时注入对应的工具格式说明。
 *
 * @param appliedTypes 已应用的 pendingWrite 类型列表（如 ['chapter_list', 'book_setting']）
 * @returns 工具提示词数组，每个元素作为独立的 system message
 */
export function buildNextStepToolPrompts(appliedTypes: string[]): string[] {
  return getNextStepToolPrompts(appliedTypes)
}

/**
 * 构建工具目录提示词（初始聊天时用）。
 * 包含所有工具的名称和一句话描述，不含详细参数说明。
 */
export function buildToolCatalogPrompt(): string {
  return getToolCatalogPrompt()
}

/**
 * 【动态段】随书/章节/记忆变化的上下文信息。
 *
 * 每次 Agent 请求都会构造新的字符串（因为 bookId / memoryText 可能变）。
 * 单独作为一条 system 消息传给模型，不影响静态段的缓存命中。
 * 返回 null 表示无动态内容（例如全新书籍、没有记忆、也没选书），此时可以省略这条消息。
 */
export function buildDynamicContextMessage(opts: {
  bookId?: string | null
  bookTitle?: string
  bookDescription?: string
  memoryText?: string
  outputLanguage?: 'follow_input' | 'chinese' | 'english'
}): string | null {
  const parts: string[] = []

  // 输出语言约束
  const langHint = getLanguageHint(opts.outputLanguage)
  if (langHint) {
    parts.push(`## 输出语言\n${langHint}`)
  }

  // 当前书籍上下文（关键：注入真实 bookId，避免 AI 编造）
  if (opts.bookId) {
    const b: string[] = ['## 当前书籍上下文', '当前选中书籍的 bookId（真实 GUID，调用工具时使用此值或直接省略即可）', opts.bookId]
    if (opts.bookTitle) b.push('书名', opts.bookTitle)
    if (opts.bookDescription) b.push('简介', opts.bookDescription)
    parts.push(b.join('\n'))
  } else if (opts.bookTitle) {
    const b: string[] = ['## 当前书籍', '书名', opts.bookTitle]
    if (opts.bookDescription) b.push('简介', opts.bookDescription)
    parts.push(b.join('\n'))
  }

  // 创作记忆
  if (opts.memoryText) {
    parts.push(`## 创作记忆（防止跑偏）\n以下是已有章节的关键记忆，创作新内容时必须遵守这些约束：\n${opts.memoryText}`)
  }

  if (parts.length === 0) return null
  return parts.join('\n\n')
}

/**
 * 构建完整的 Agent 系统提示词（**保留但已弃用**，仅供旧调用兼容）。
 *
 * 新代码请直接使用 buildStaticSystemMessage + buildDynamicContextMessage 分两条 system 消息发送，
 * 以获得更高的 prompt-prefix 缓存命中率。
 */
export function buildAgentSystemPrompt(opts: {
  bookId?: string | null
  bookTitle?: string
  bookDescription?: string
  memoryText?: string
  useNativeFunctionCalling: boolean
}): string {
  const staticPart = buildStaticSystemMessage(opts.useNativeFunctionCalling)
  const dynamicPart = buildDynamicContextMessage(opts)
  return dynamicPart ? `${staticPart}\n\n${dynamicPart}` : staticPart
}

/** 把创作记忆转换为注入文本 */
export function memoryToText(memory: BookMemory | null, opts?: { maxChapters?: number }): string {
  if (!memory || memory.chapters.length === 0) {
    return memory?.activeForeshadowings?.length
      ? `### 未回收伏笔\n${memory.activeForeshadowings.map((f) => `- ${f.entityName || '未知'}：${f.content}`).join('\n')}`
      : '暂无创作记忆（这是新书或尚未生成任何章节记忆）'
  }

  const maxChapters = opts?.maxChapters ?? 5
  const recentChapters = memory.chapters.slice(-maxChapters)
  const lines: string[] = []

  for (const ch of recentChapters) {
    lines.push(`### 第${ch.chapterOrder + 1}章「${ch.chapterTitle}」`)
    const byType: Record<string, string[]> = {}
    for (const entry of ch.entries) {
      if (!byType[entry.type]) byType[entry.type] = []
      byType[entry.type].push(`${entry.entityName ? `[${entry.entityName}] ` : ''}${entry.content}`)
    }
    if (byType.character_status) {
      lines.push(`角色状态：`)
      byType.character_status.forEach((s) => lines.push(`  - ${s}`))
    }
    if (byType.plot_event) {
      lines.push(`关键事件：`)
      byType.plot_event.forEach((s) => lines.push(`  - ${s}`))
    }
    if (byType.setting_change) {
      lines.push(`设定变更：`)
      byType.setting_change.forEach((s) => lines.push(`  - ${s}`))
    }
    if (byType.world_fact) {
      lines.push(`世界事实：`)
      byType.world_fact.forEach((s) => lines.push(`  - ${s}`))
    }
    lines.push('')
  }

  if (memory.activeForeshadowings.length > 0) {
    lines.push('### 未回收伏笔（创作时需考虑回收或延续）')
    for (const f of memory.activeForeshadowings) {
      lines.push(`- ${f.entityName || '未知'}：${f.content}`)
    }
  }

  return lines.join('\n')
}
