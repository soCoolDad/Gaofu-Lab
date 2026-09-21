/**
 * 技能导入：从 GitHub 链接或 Zip 压缩包收集技能草稿（不直接入库，
 * 草稿返回给前端预览，用户确认后逐个走 skill:create 创建）。
 *
 * GitHub 链接支持：
 *   - 仓库根 / tree 目录：自动查找目录下（含一级子目录）的 SKILL.md，
 *     找不到则把目录下的 .md/.txt/.json（跳过 README）当技能导入
 *   - blob / raw 文件链接：直接下载解析单个文件
 *   - 其他任意 http(s) 文本链接：按 Markdown / JSON 技能文档解析
 * GitHub API 未认证限流 60 次/小时，目录遍历有调用预算（BUDGET_CALLS），超限即停。
 */

import AdmZip from 'adm-zip'
import { parseSkillDoc, isSkillFileName, type SkillDraft } from './skill-doc'

const MAX_DRAFTS = 30
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ZIP_BYTES = 30 * 1024 * 1024
/** GitHub API（未认证）调用预算，防止大仓库把 60 次/小时的限流烧光 */
const BUDGET_CALLS = 25
/** 目录递归查找 SKILL.md 的深度（仓库根 → 子目录 → 子子目录） */
const MAX_DIR_DEPTH = 2

const GH_HEADERS: Record<string, string> = {
  'User-Agent': 'gaofu-lab-skill-importer',
  Accept: 'application/vnd.github+json',
}

/** 给用户的可读错误（与普通异常区分开，message 直接透传给前端） */
class ImportError extends Error {}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { headers: GH_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e: any) {
    if (e?.name === 'TimeoutError') throw new ImportError('下载超时，请检查网络 / 代理后重试')
    throw new ImportError('网络请求失败：' + (e?.message || e))
  }
  if (res.status === 404) throw new ImportError('链接返回 404：文件或目录不存在，请检查仓库、分支与路径')
  if (res.status === 403) throw new ImportError('GitHub 返回 403（可能触发了未认证限流），请稍后再试')
  if (!res.ok) throw new ImportError(`下载失败：HTTP ${res.status}`)
  return res.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ImportError('GitHub API 返回了非 JSON 内容，请稍后再试')
  }
}

type GhEntry = {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  download_url: string | null
}

type GhTarget =
  | { kind: 'raw'; rawUrl: string; fileName: string }
  | { kind: 'contents'; apiBase: string; path: string; ref?: string }
  | { kind: 'generic'; url: string; fileName: string }

function classifyUrl(raw: string): GhTarget {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new ImportError('链接格式不正确')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ImportError('仅支持 http/https 链接')

  const host = u.hostname.replace(/^www\./, '')
  const segs = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))

  if (host === 'github.com') {
    if (segs.length < 2) throw new ImportError('GitHub 链接不完整，请粘贴 仓库 / tree / blob 链接')
    const [owner, repoRaw, kind, ...rest] = segs
    const repo = repoRaw.replace(/\.git$/i, '')
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`
    if (!kind) return { kind: 'contents', apiBase, path: '', ref: undefined }
    if (kind === 'blob' || kind === 'tree') {
      if (rest.length === 0) throw new ImportError('链接缺少分支 / 路径部分')
      const ref = rest[0]
      const path = rest.slice(1).join('/')
      if (kind === 'blob') {
        if (!path) {
          // blob/{ref} 当成目录根处理
          return { kind: 'contents', apiBase, path: '', ref }
        }
        return {
          kind: 'raw',
          rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
          fileName: path.split('/').pop() || path,
        }
      }
      return { kind: 'contents', apiBase, path, ref }
    }
    throw new ImportError('暂不支持该 GitHub 页面类型（仅支持仓库 / tree / blob 链接）')
  }

  if (host === 'raw.githubusercontent.com') {
    // /{owner}/{repo}/{ref}/{...path}
    const path = segs.slice(3).join('/')
    if (segs.length < 4 || !path) throw new ImportError('raw 链接不完整，缺少文件路径')
    return { kind: 'raw', rawUrl: `https://${host}${u.pathname}`, fileName: path.split('/').pop() || path }
  }

  return { kind: 'generic', url: u.origin + u.pathname, fileName: segs[segs.length - 1] || 'skill.md' }
}

function contentsListUrl(apiBase: string, path: string, ref?: string): string {
  const p = path ? path.split('/').map(encodeURIComponent).join('/') : ''
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  return apiBase + (p ? '/' + p : '') + q
}

async function collectFromDir(
  apiBase: string,
  path: string,
  ref: string | undefined,
  depth: number,
  budget: { calls: number },
): Promise<SkillDraft[]> {
  if (budget.calls <= 0) return []
  budget.calls--
  const list = await fetchJson<GhEntry | GhEntry[]>(contentsListUrl(apiBase, path, ref))
  const entries = Array.isArray(list) ? list : [list]
  const drafts: SkillDraft[] = []

  // 目录内有 SKILL.md：整目录就是单个技能
  const skillMd = entries.find((e) => e.type === 'file' && e.name.toLowerCase() === 'skill.md')
  if (skillMd?.download_url) {
    const d = parseSkillDoc(skillMd.path, await fetchText(skillMd.download_url), skillMd.download_url)
    if (d) drafts.push(d)
    return drafts
  }

  // 用户直接指到了某个文件（contents API 对文件路径返回单对象）
  if (!Array.isArray(list)) {
    if (list.type === 'file' && list.download_url) {
      const d = parseSkillDoc(list.name, await fetchText(list.download_url), list.download_url)
      if (d) drafts.push(d)
    }
    return drafts
  }

  // 递归子目录找 SKILL.md（常见布局：skills/<name>/SKILL.md）
  if (depth > 0) {
    for (const e of entries.filter((x) => x.type === 'dir')) {
      if (drafts.length >= MAX_DRAFTS || budget.calls <= 0) break
      try {
        const sub = await collectFromDir(apiBase, e.path, ref, depth - 1, budget)
        drafts.push(...sub)
      } catch (err: any) {
        // 单个子目录拉取失败（网络抖动 / 限流 / 超时）不阻断整体导入，跳过继续
        console.warn('[skill-import] 子目录拉取失败，已跳过:', e.path, err?.message || err)
      }
    }
  }

  // 兜底：当前目录的散装 .md/.txt/.json（跳过 README，那是仓库说明不是技能）
  if (drafts.length === 0) {
    for (const e of entries.filter(
      (x) => x.type === 'file' && isSkillFileName(x.name) && !/^readme(\.|$)/i.test(x.name),
    )) {
      if (drafts.length >= MAX_DRAFTS) break
      if (!e.download_url) continue
      let text: string
      try {
        text = await fetchText(e.download_url)
      } catch (err: any) {
        console.warn('[skill-import] 文件下载失败，已跳过:', e.path, err?.message || err)
        continue
      }
      const d = parseSkillDoc(e.name, text, e.download_url)
      if (d) drafts.push(d)
    }
  }
  return drafts
}

/** 从 GitHub / 任意文本链接收集技能草稿 */
export async function collectSkillDraftsFromUrl(rawUrl: string): Promise<SkillDraft[]> {
  const target = classifyUrl(rawUrl)

  if (target.kind === 'raw') {
    const text = await fetchText(target.rawUrl)
    const d = parseSkillDoc(target.fileName, text, target.rawUrl)
    if (!d) throw new ImportError('该文件内容为空或无法解析为技能')
    return [d]
  }

  if (target.kind === 'generic') {
    const text = await fetchText(target.url)
    const name = isSkillFileName(target.fileName) ? target.fileName : target.fileName + '.md'
    const d = parseSkillDoc(name, text, target.url)
    if (!d) throw new ImportError('该链接内容为空或无法解析为技能（支持 Markdown / JSON 技能文档）')
    return [d]
  }

  const drafts = await collectFromDir(target.apiBase, target.path, target.ref, MAX_DIR_DEPTH, { calls: BUDGET_CALLS })
  if (!drafts.length) {
    throw new ImportError(
      '该链接下未找到可导入的技能文件（SKILL.md / .md / .txt / .json）。' +
        '建议直接粘贴技能文件的 blob 链接，例如 https://github.com/用户/仓库/blob/main/SKILL.md',
    )
  }
  return drafts
}

function isSkillMdEntry(entryName: string): boolean {
  const base = entryName.split('/').pop() || ''
  return base.toLowerCase() === 'skill.md'
}

/** 从 Zip 压缩包（内存 buffer）收集技能草稿，只读文本文件、不落盘 */
export function collectSkillDraftsFromZip(buffer: Buffer): SkillDraft[] {
  if (buffer.length > MAX_ZIP_BYTES) throw new ImportError('压缩包超过 30MB，请检查文件')
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new ImportError('无法读取压缩包，请确认上传的是有效的 Zip 文件')
  }

  const entries = zip.getEntries().filter((e) => {
    if (e.isDirectory) return false
    const name = e.entryName
    if (/__MACOSX/i.test(name)) return false
    const base = name.split('/').pop() || ''
    if (base.startsWith('.')) return false
    // README 是仓库说明不是技能（与 GitHub 目录导入行为一致；显式指名的文件不受此限）
    if (/^readme(\.|$)/i.test(base)) return false
    if (e.header.size > MAX_FILE_BYTES) return false
    return isSkillFileName(name)
  })

  // SKILL.md（带 frontmatter，信息最全）排前面
  const sorted = [...entries].sort(
    (a, b) => Number(isSkillMdEntry(b.entryName)) - Number(isSkillMdEntry(a.entryName)),
  )

  const drafts: SkillDraft[] = []
  const seen = new Set<string>()
  for (const e of sorted) {
    if (drafts.length >= MAX_DRAFTS) break
    let text = ''
    try {
      text = zip.readAsText(e, 'utf8')
    } catch {
      continue
    }
    const d = parseSkillDoc(e.entryName, text, e.entryName)
    if (!d) continue
    const key = d.name + '\n' + d.prompt
    if (seen.has(key)) continue
    seen.add(key)
    drafts.push(d)
  }

  if (!drafts.length) {
    throw new ImportError('压缩包内未找到可导入的技能文件（SKILL.md / .md / .txt / .json）')
  }
  return drafts
}
