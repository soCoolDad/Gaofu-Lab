/**
 * 技能文档解析：把 GitHub / Zip 导入的文件内容解析为技能草稿。
 *
 * 支持三种格式（与 Claude Skill 生态兼容）：
 *   1. SKILL.md / 带 YAML frontmatter 的 Markdown：
 *        ---
 *        name: humanizer-zh
 *        description: 去除 AI 味
 *        ---
 *        （正文整体作为技能提示词）
 *   2. JSON：{ "name": "...", "description": "...", "prompt": "..." }
 *   3. 纯文本 / 普通 Markdown：文件名（去扩展名）作为技能名，全文作为提示词
 *
 * 解析失败或内容为空时返回 null，由调用方决定跳过或报错。
 */

export type SkillDraft = {
  name: string
  description: string
  prompt: string
  /** 来源标注（原始 URL / zip 内路径），仅用于前端展示 */
  source?: string
}

/** 可作为技能导入的文本文件扩展名 */
export const SKILL_FILE_EXTS = ['.md', '.markdown', '.txt', '.json']

export function isSkillFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SKILL_FILE_EXTS.some((ext) => lower.endsWith(ext))
}

/** 去掉路径中的目录部分与扩展名，作为默认技能名 */
export function baseName(fileName: string): string {
  const name = fileName.split('/').pop() || fileName
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1)
  }
  return v
}

/** 极简 YAML frontmatter 解析：只取顶层 `key: value` 行（name/description 等场景足够） */
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } | null {
  const lines = content.split(/\r?\n/)
  if ((lines[0] || '').trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] || '').trim() === '---') { end = i; break }
  }
  if (end < 0) return null
  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z_$][\w$-]*)\s*:\s*(.*)$/)
    if (m) meta[m[1].toLowerCase()] = stripQuotes(m[2].trim())
  }
  const body = lines.slice(end + 1).join('\n').trim()
  return { meta, body }
}

/**
 * 把单个文件内容解析为技能草稿。
 * @param fileName 文件名（含扩展名，可含路径，用于兜底命名）
 * @param content 文本内容
 * @param source 来源标注（URL / zip 内路径），透传给前端展示
 */
export function parseSkillDoc(fileName: string, content: string, source?: string): SkillDraft | null {
  const text = (content || '').replace(/^\uFEFF/, '').trim()
  if (!text) return null

  const fallbackName = baseName(fileName).trim() || '未命名技能'

  // 1) JSON 格式
  if (fileName.toLowerCase().endsWith('.json')) {
    try {
      const obj = JSON.parse(text)
      const prompt = String(obj?.prompt ?? obj?.content ?? '').trim()
      if (!prompt) return null
      return {
        name: String(obj?.name || fallbackName).trim(),
        description: String(obj?.description ?? '').trim(),
        prompt,
        source,
      }
    } catch {
      return null
    }
  }

  // 2) frontmatter Markdown（SKILL.md 生态格式）
  if (text.startsWith('---')) {
    const fm = parseFrontmatter(text)
    if (fm) {
      const prompt = fm.body || text
      return {
        name: (fm.meta.name || fallbackName).trim(),
        description: (fm.meta.description || '').trim(),
        prompt,
        source,
      }
    }
  }

  // 3) 纯文本 / 普通 Markdown：全文即提示词
  //    尽量取第一个标题当名字，取第一段非标题文字当描述
  let name = fallbackName
  let description = ''
  const bodyLines = text.split(/\r?\n/).filter((l) => !l.trim().startsWith('```'))
  const heading = bodyLines.find((l) => /^#{1,3}\s+\S/.test(l.trim()))
  if (heading) name = heading.trim().replace(/^#{1,3}\s+/, '').slice(0, 60).trim() || fallbackName
  const para = bodyLines.map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('---'))
  if (para) description = para.replace(/[#*`>\-]/g, '').slice(0, 80).trim()

  return { name, description, prompt: text, source }
}
