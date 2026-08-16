/**
 * 工具名 → 用户可读的"动作"标签
 *
 * 用途：
 *  - 落库到 token_usage_logs.action 前，把 Agent 本次运行调用过的工具映射为中文
 *  - Token 消耗记录面板可直接展示，无需在前端二次翻译
 *
 * 若一次运行调用了多个"写"工具（如 create_chapters + write_chapter_content），
 * 由调用方 `join(' + ')` 后写入。
 *
 * 未识别的工具名会返回工具名本身，避免出现空字符串。
 */

// 只读工具：一般不作为主动作展示（除非本次运行仅调用了它们）
const READ_ONLY_TOOLS = new Set([
  'list_books',
  'get_book',
  'list_volumes',
  'list_chapters',
  'get_chapter',
  'get_chapter_content',
  'get_book_outline',
  'list_settings',
  'list_snapshots',
  'get_snapshot',
  'get_volume',
  'get_setting',
  'mark_resume_after_apply',
])

const TOOL_LABEL_MAP: Record<string, string> = {
  // 书籍
  create_book: '创建书籍',
  update_book: '编辑书籍',

  // 分卷
  create_volumes: '创建分卷',
  update_volume: '编辑分卷',
  update_volume_outline: '编辑分卷大纲',

  // 章节
  create_chapters: '创建章节',
  update_chapter: '编辑章节',
  update_chapter_outline: '编辑章节大纲',
  write_chapter_content: '写作正文',

  // 大纲
  write_book_outline: '编辑全书大纲',

  // 设定
  create_settings: '创建设定',
  update_setting: '编辑设定条目',
  delete_entity: '删除',

  // 记忆
  generate_snapshot: '生成章节记忆',

  // 只读（万一被作为唯一动作展示时的中文名）
  list_books: '书籍列表',
  get_book: '查看书籍',
  list_volumes: '分卷列表',
  get_volume: '查看分卷',
  list_chapters: '章节列表',
  get_chapter: '查看章节',
  get_chapter_content: '查看正文',
  get_book_outline: '查看全书大纲',
  list_settings: '设定列表',
  get_setting: '查看设定条目',
  list_snapshots: '记忆列表',
  get_snapshot: '查看章节记忆',
}

export function toolNameToActionLabel(name: string): string {
  return TOOL_LABEL_MAP[name] || name
}

/**
 * 把一次 Agent 运行的 tool 调用列表 → 单个"动作"字符串，用于写入 token_usage_logs.action。
 *
 * 规则：
 *  1. 优先展示"写工具"（有副作用/PendingWrite）：过滤掉只读工具
 *  2. 去重、保持首次出现顺序
 *  3. 多个写工具用 " + " 连接
 *  4. 全部都是只读工具时，退回到只读工具的中文名列表
 *  5. 没有任何工具调用（纯对话）→ '对话'
 */
export function summarizeAgentAction(toolNames: string[]): string {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return '对话'
  const seen = new Set<string>()
  const writes: string[] = []
  const reads: string[] = []
  for (const n of toolNames) {
    if (!n || seen.has(n)) continue
    seen.add(n)
    if (READ_ONLY_TOOLS.has(n)) reads.push(toolNameToActionLabel(n))
    else writes.push(toolNameToActionLabel(n))
  }
  if (writes.length > 0) return writes.join(' + ')
  if (reads.length > 0) return reads.join(' + ')
  return '对话'
}
