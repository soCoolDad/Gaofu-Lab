import type { AgentPlan, AiGeneratedResult, ParsedAiDataBlock } from './ai.types'

// ─── 标签常量 ──────────────────────────────────────────────

export const LOCATION_LABELS: Record<string, string> = {
  book: '书籍',
  outline: '大纲',
  volumes: '分卷列表',
  chapters: '章节列表',
  chapter: '章节',
  editor: '正文',
  characters: '角色',
  inspirations: '灵感',
  locations: '地点',
  items: '物品',
  skills: '技能',
  scenes: '场景',
  factions: '势力',
  systems: '体系',
}

export const ACTION_LABELS: Record<string, string> = {
  new: '新建',
  edit: '编辑',
  remove: '删除',
  view: '查看',
}

// data_start header 定位正则
// 兼容三种输出：
//   1) 每块独立成对围栏：``` data_start;...;data_end\n<body>\n```
//   2) 相邻块共用中间围栏：``` data_start;...;data_end\n<body1>\n``` data_start;...;data_end\n<body2>\n```
//   3) 缺失起始/收尾围栏：data_start;...;data_end\n<body>
const AI_DATA_BLOCK_HEADER_REGEX = /(?:```\s*)?data_start;([^;]+);([^;]+);([^;]+);data_end/gi

// ─── 围栏规范化 ────────────────────────────────────────────

export function normalizeAiDataBlockFences(input: string): string {
  let src = input || ''
  if (!src) return src
  src = src.replace(
    /(^|\n)```[ \t]*\n(data_start;[^;\n]+;[^;\n]+;[^;\n]+;data_end)/g,
    '$1``` $2'
  )
  const headers: number[] = []
  const rx = /data_start;[^;]+;[^;]+;[^;]+;data_end/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) headers.push(m.index)
  if (headers.length === 0) return src
  const parts: string[] = []
  let cursor = 0
  for (let i = 0; i < headers.length; i++) {
    const hStart = headers[i]
    let leading = src.slice(cursor, hStart)
    const fencesInLeading = (leading.match(/```/g) || []).length
    if (i === 0) {
      if (fencesInLeading === 0) {
        leading = leading.replace(/\s*$/, '') + '\n``` '
      }
    } else {
      const needed = 2 - fencesInLeading
      if (needed === 2) {
        leading = leading.replace(/\s*$/, '') + '\n```\n\n``` '
      } else if (needed === 1) {
        leading = leading.replace(/\s*$/, '') + '\n``` '
      }
    }
    parts.push(leading)
    cursor = hStart
  }
  let tail = src.slice(cursor)
  const tailFences = (tail.match(/```/g) || []).length
  if (tailFences === 0) {
    tail = tail.replace(/\s*$/, '') + '\n```'
  }
  parts.push(tail)
  return parts.join('')
}

// ─── 解析 ──────────────────────────────────────────────────

export function parseAiDataBlocks(content: string): ParsedAiDataBlock[] {
  const blocks: ParsedAiDataBlock[] = []
  if (!content) return blocks
  const headers: Array<{ location: string; action: string; dbIndex: string; headerEnd: number }> = []
  const headerRegex = new RegExp(AI_DATA_BLOCK_HEADER_REGEX.source, AI_DATA_BLOCK_HEADER_REGEX.flags)
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(content)) !== null) {
    headers.push({
      location: m[1].trim(),
      action: m[2].trim(),
      dbIndex: m[3].trim(),
      headerEnd: m.index + m[0].length,
    })
  }
  if (!headers.length) return blocks
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]
    const bodyEnd = i + 1 < headers.length
      ? content.slice(0, headers[i + 1].headerEnd).lastIndexOf('data_start;')
      : content.length
    const nextHeaderIdx = i + 1 < headers.length
      ? content.indexOf('data_start;', h.headerEnd)
      : -1
    let bodyRaw = content.slice(h.headerEnd, nextHeaderIdx >= 0 ? nextHeaderIdx : bodyEnd)
    bodyRaw = bodyRaw.replace(/^\s*/, '').replace(/\s*```\s*$/, '').replace(/\s*```\s*/g, (match, offset, str) => {
      return offset > str.length - 8 ? '' : match
    })
    blocks.push({
      location: h.location,
      action: h.action,
      dbIndex: h.dbIndex,
      content: bodyRaw.trim(),
    })
  }
  return blocks
}

export function stripAllAiDataBlocks(content: string): string {
  if (!content) return ''
  const headerRegex = new RegExp(AI_DATA_BLOCK_HEADER_REGEX.source, AI_DATA_BLOCK_HEADER_REGEX.flags)
  const ranges: Array<[number, number]> = []
  let m: RegExpExecArray | null
  const headers: Array<{ start: number; headerEnd: number }> = []
  while ((m = headerRegex.exec(content)) !== null) {
    let start = m.index
    const prefixMatch = content.slice(Math.max(0, m.index - 10), m.index).match(/```\s*$/)
    if (prefixMatch) start = m.index - (prefixMatch[0].length)
    headers.push({ start, headerEnd: m.index + m[0].length })
  }
  if (!headers.length) return content.trim()
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]
    const end = i + 1 < headers.length ? headers[i + 1].start : content.length
    ranges.push([h.start, end])
  }
  let out = ''
  let cursor = 0
  for (const [s, e] of ranges) {
    out += content.slice(cursor, s)
    cursor = e
  }
  out += content.slice(cursor)
  return out.replace(/```\s*$/, '').trim()
}

// ─── Markdown 数据条目解析 ─────────────────────────────────

export function parseMdDataItems(content: string, fields: string[]): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = []
  if (!content || fields.length === 0) return items
  const baseLevel = 3
  const maxLevel = baseLevel + fields.length - 1
  const lines = content.split('\n')
  let currentItem: Record<string, string> | null = null
  let currentHeadings: Record<string, string> | null = null
  let currentFieldIndex = -1
  const flush = () => {
    if (!currentItem || !currentHeadings) return
    for (const f of fields) {
      const body = (currentItem[f] || '').replace(/^\n+|\n+$/g, '')
      currentItem[f] = body || (currentHeadings[f] || '')
    }
    if (fields.some((f) => currentItem![f])) items.push(currentItem!)
  }
  for (const line of lines) {
    const m = line.match(/^(#{3,6})\s+(.*)$/)
    if (m) {
      const level = m[1].length
      if (level >= baseLevel && level <= maxLevel) {
        const fieldIdx = level - baseLevel
        if (fieldIdx === 0) {
          flush()
          currentItem = {}
          currentHeadings = {}
          for (const f of fields) { currentItem[f] = ''; currentHeadings[f] = '' }
        }
        if (currentItem && currentHeadings) {
          currentFieldIndex = fieldIdx
          currentHeadings[fields[fieldIdx]] = m[2].trim()
        }
        continue
      }
    }
    if (currentItem && currentFieldIndex >= 0) {
      const field = fields[currentFieldIndex]
      currentItem[field] = (currentItem[field] ? currentItem[field] + '\n' : '') + line
    }
  }
  flush()
  return items.filter((item) => item[fields[0]])
}

export function parseBookInfoUpdate(content: string): { title?: string; description?: string; detail?: string } | null {
  const items = parseMdDataItems(content || '', ['title', 'description', 'detail'])
  if (!items.length) return null
  const first = items[0]
  const result: { title?: string; description?: string; detail?: string } = {}
  if (first.title) result.title = first.title.split('\n')[0].trim()
  if (first.description) result.description = first.description.trim()
  if (first.detail) result.detail = first.detail.trim()
  if (!result.title && !result.description && !result.detail) return null
  return result
}

// ─── 内容清理 ──────────────────────────────────────────────

export function cleanApplyableContentFromAi(content: string) {
  const isMetaBlock = (value: string) => {
    const text = value.trim()
    if (!text) return true
    return /^(好的|当然|可以|以下是|下面是|已根据|根据.*生成|我为你|这里是)/.test(text)
      || /^(此|以上|该|这些|本)[\s\S]{0,80}(已|可|可以|适合|能够)[\s\S]{0,80}(保存|写入|应用|使用|扩展|继续)/.test(text)
      || /^(后续|接下来|下一步|如需|如果需要|你可以|可继续|可以继续|建议后续)/.test(text)
  }

  // 兜底：模型输出的正文中如果没有真换行符但包含字面 \n，说明 JSON 层可能
  // 发生了双重转义（\\n → 经过 JSON.parse → 字面 \n），将其还原为真换行符
  let text = content
  if (!/\n/.test(text) && /\\n/.test(text)) {
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
  }
  text = stripAllAiDataBlocks(text)
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  while (blocks.length > 1 && isMetaBlock(blocks[0])) blocks.shift()
  while (blocks.length > 1 && isMetaBlock(blocks[blocks.length - 1])) blocks.pop()
  text = blocks.join('\n\n').trim()
  const lines = text.split('\n')
  while (lines.length > 1 && isMetaBlock(lines[lines.length - 1])) lines.pop()
  return lines.join('\n').trim()
}

export function cleanOutlineContentFromAi(content: string, bookTitle?: string | null) {
  let text = cleanApplyableContentFromAi(content)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const normalizeFn = (value: string) => value
    .replace(/[\s*_#《》「」『』【】\[\]（）()：:，,。.！!？?·\-—]/g, '')
    .toLowerCase()
  const titleNormalized = normalizeFn(bookTitle || '')

  while (lines.length > 1) {
    const first = lines[0].trim()
    const cleaned = first.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim()
    const normalized = normalizeFn(cleaned)
    if (!cleaned) { lines.shift(); continue }
    const hasOutlineText = /(全书大纲|作品大纲|故事大纲|小说大纲|大纲)/.test(cleaned)
    const isTitleOnly = !!titleNormalized && normalized === titleNormalized
    const isTitleOutline = !!titleNormalized && normalized.includes(titleNormalized) && hasOutlineText
    const isGenericOutlineTitle = /^(全书大纲|作品大纲|故事大纲|小说大纲|大纲)[：:]*$/.test(cleaned)
    const isNamedOutlineTitle = /^.{1,40}(全书大纲|作品大纲|故事大纲|小说大纲)$/.test(cleaned)
    if (isTitleOnly || isTitleOutline || isGenericOutlineTitle || isNamedOutlineTitle) { lines.shift(); continue }
    break
  }
  return lines.join('\n').trim()
}

export function cleanEditorContentFromAi(content: string, chapterTitle?: string | null) {
  let text = cleanApplyableContentFromAi(content)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const normalizeFn = (value: string) => value
    .replace(/[\s*_#《》「」『』【】\[\]（）()：:，,。.！!？?·\-—]/g, '')
    .toLowerCase()
  const titleNormalized = normalizeFn(chapterTitle || '')

  // 1) 剥除开头：章节标题、"第 X 章 XXX" 等
  while (lines.length > 0) {
    const first = lines[0].trim()
    const cleaned = first.replace(/^#{1,6}\s*/, '').replace(/^\*\*(.*?)\*\*$/, '$1').trim()
    const firstNormalized = normalizeFn(cleaned)
    if (!cleaned) { lines.shift(); continue }
    if ((titleNormalized && firstNormalized === titleNormalized) || /^第[一二三四五六七八九十百千万\d]+[章节回][\s\S]{0,40}$/.test(cleaned)) {
      lines.shift(); continue
    }
    break
  }

  // 2) 剥除正文中间的"一、XXX / 二、XXX / （一）XXX / 1. XXX / #### XXX"这类分段小标题独占行
  //    只匹配独占一行、且长度不超过 30 字的短标题行，避免误伤正文语句
  const sectionHeadingRe = /^(?:\s*(?:[#]{1,6})\s+.{1,40}|\s*(?:[一二三四五六七八九十百千万]+|\d+)[、\.．]\s*.{0,30}|\s*[（(](?:[一二三四五六七八九十百千万]+|\d+)[）)]\s*.{0,30})\s*$/
  const filtered: string[] = []
  for (const raw of lines) {
    if (sectionHeadingRe.test(raw)) {
      // 保留一个空行做段落分隔
      if (filtered.length > 0 && filtered[filtered.length - 1].trim() !== '') {
        filtered.push('')
      }
      continue
    }
    filtered.push(raw)
  }

  // 3) 剥除结尾的"本章完 / 未完待续 / （章末） / 全章完 / —— 全文完 ——" 等
  const tailBadRe = /^\s*(?:[（(【\[]*\s*(?:本章完|全章完|全文完|本节完|未完待续|下章预告|章末|— *全章完 *—|—— *全章完 *——|—— *本章完 *——)\s*[）)】\]]*|\*+\s*(?:本章完|全章完|全文完|本节完|未完待续)\s*\*+)\s*$/
  while (filtered.length > 0) {
    const last = filtered[filtered.length - 1].trim()
    if (!last) { filtered.pop(); continue }
    if (tailBadRe.test(last)) { filtered.pop(); continue }
    break
  }

  return filtered.join('\n').trim()
}

// ─── 类型映射 ──────────────────────────────────────────────

export function mapOutputContractType(rawType: string): AiGeneratedResult['type'] | null {
  const typeMap: Record<string, AiGeneratedResult['type']> = {
    outline: 'book_outline',
    book_outline: 'book_outline',
    volume_list: 'volume_list',
    volume_outline: 'volume_outline',
    chapter_list: 'chapter_list',
    chapter_outline: 'chapter_outline',
    chapter_content: 'chapter_content',
    chapter_content_list: 'chapter_content_list',
    book_setting_list: 'book_setting_list',
    book_info_update: 'book_info_update',
    answer: 'chat_answer',
    chat_answer: 'chat_answer',
    novel_text: 'chapter_content',
    delete_plan: 'delete_plan',
    chapter_snapshot: 'chapter_snapshot',
  }
  return typeMap[rawType] || null
}

export function outputTypeToProtocolHeader(outputType: string, targetSettingType?: string): { location: string; action: string } {
  switch (outputType) {
    case 'book_info_update': return { location: 'book', action: 'edit' }
    case 'book_setting_list': return { location: targetSettingType || 'characters', action: 'new' }
    case 'volume_list': return { location: 'volumes', action: 'new' }
    case 'chapter_list': return { location: 'chapters', action: 'new' }
    case 'outline':
    case 'book_outline': return { location: 'outline', action: 'edit' }
    case 'novel_text':
    case 'chapter_content': return { location: 'editor', action: 'edit' }
    case 'volume_outline': return { location: 'volumes', action: 'edit' }
    case 'chapter_outline': return { location: 'chapters', action: 'edit' }
    case 'chapter_snapshot': return { location: 'chapterContent', action: 'finalize' }
    case 'delete_plan': return { location: 'book', action: 'remove' }
    default: return { location: 'book', action: 'view' }
  }
}

export function protocolHeaderToOutputType(location: string, action: string, plan?: AgentPlan): AiGeneratedResult['type'] | null {
  if (action === 'finalize') return 'chapter_snapshot'
  if (action === 'remove') return 'delete_plan'
  if (location === 'book') return action === 'edit' || action === 'new' ? 'book_info_update' : 'chat_answer'
  if (location === 'outline') return 'book_outline'
  if (location === 'editor') return 'chapter_content'
  if (location === 'volumes') { return action === 'new' ? 'volume_list' : 'volume_outline' }
  if (location === 'chapters') { return action === 'new' ? 'chapter_list' : 'chapter_outline' }
  if (location === 'chapter') return 'chapter_outline'
  if (location === 'chapter_snapshot') return 'chapter_snapshot'
  if (['characters', 'inspirations', 'locations', 'items', 'skills', 'scenes', 'factions', 'systems'].includes(location)) {
    return 'book_setting_list'
  }
  return plan?.outputContract?.type ? mapOutputContractType(plan.outputContract.type) : null
}
