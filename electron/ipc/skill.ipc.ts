/**
 * AI 技能 IPC 处理器
 *
 * 用户可导入的「提示词技能」系统：技能定义（名称/描述/提示词）与执行机制分离，
 * 导入任意技能都不需要改代码。humanizer-zh（去 AI 味）是第一个种子技能。
 *
 * 与世界观「技能」(bookSettingEntries, type=skills) 完全无关：这里是给编辑器 / Agent
 * 调用的提示词技能，全局通用、不绑定作品。
 *
 * IPC 通道：
 * - skill:list           列出技能（默认只返回启用的）
 * - skill:create         新增技能
 * - skill:update         更新技能
 * - skill:delete         删除技能
 * - skill:invoke         用指定技能处理一段文本（读技能 prompt → 调模型改写 → 返回结果）
 * - skill:importFromUrl  从 GitHub 链接下载技能文档，解析为草稿返回（前端预览确认后创建）
 * - skill:importZip      解包 Zip 压缩包为技能草稿返回（同上）
 */

import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { aiSkills, appMeta, modelProviders } from '../db/schema'
import { decodeModelApiKey } from './model.ipc'
import { runAgentModel, AgentModelError } from '../agent/model-caller'
import { resolveSamplingParams } from '../utils/sampling'
import { collectSkillDraftsFromUrl, collectSkillDraftsFromZip } from '../utils/skill-import'
import { normalizeRawUsage, computeUsageCost, hasUsableUsage, insertTokenLog } from '../utils/token-log'
import { assertBillingRulesConfigured } from '../utils/billing'
import { v4 as uuidv4 } from 'uuid'

// ─── 种子技能：humanizer-zh（精简版，去除 AI 写作痕迹） ─────────────
// 精简自 humanizer-zh 的完整指南：保留核心原则 + 24 类模式清单 + 处理流程 + 输出格式，
// 覆盖绝大多数 AI 味，同时控制 prompt 体积。
const HUMANIZER_ZH_PROMPT = `你是一位文字编辑，专门识别和去除 AI 生成文本的痕迹，使文字听起来更自然、更有人味。参考维基百科"AI 写作特征"指南。

# 核心原则
1. 删除填充短语（开场白、强调性拐杖词）。
2. 打破公式结构（避免二元对比、戏剧性分段、修辞性设置）。
3. 变化节奏（混合句子长短；两项优于三项；段落结尾要多样化）。
4. 信任读者（直接陈述事实，跳过软化、辩解和手把手引导）。
5. 删除金句（听起来像可引用语句的就重写）。

# 要识别并修复的 AI 痕迹
- 夸大意义/遗产/趋势：作为/标志着/彰显了/关键转折点/不断演变的格局/不可磨灭的印记/核心的/至关重要的。
- 宣传式语言：充满活力/丰富/深刻/开创性/必游之地/迷人的/坐落于/位于……的中心/展示/体现/致力于。
- 以 -ing 收尾的肤浅分析：凸显……、确保……、反映……、为……做出贡献、培养……、涵盖……、展示……。
- 模糊归因：行业报告显示/观察者指出/专家认为/多个来源（却无具体引用）。
- 提纲式"挑战与未来展望"段落。
- 高频 AI 词汇：此外/至关重要/深入探讨/增强/培养/复杂/关键/格局/展示/织锦/宝贵的/充满活力/一致性。
- 系动词回避：用"作为/代表/标志着"替代简单的"是/有"。
- 否定式排比："不仅是……更是……""这不仅仅是……而是……"。
- 三段式法则（强行把想法分三组显得全面）。
- 刻意换词循环（同义词反复替换，如 主人公/主要角色/中心人物）。
- 虚假范围："从 X 到 Y"但 X/Y 不在同一有意义尺度上。
- 破折号（—）过度使用，模仿"有力"销售文案。
- 粗体/表情符号过度使用。
- 协作交流痕迹：希望这对您有帮助/当然！/您说得完全正确/请告诉我。
- 知识截止免责声明：截至……/根据我最后的训练更新/虽然细节有限……。
- 谄媚语气：好问题！您说得完全正确。
- 填充短语：为了实现这一目标→为了实现这一点；在这个时间点→现在；系统具有……的能力→系统可以……。
- 过度限定：可能潜在地被认为→可能。
- 通用积极结尾：公司的未来看起来光明/激动人心的时代即将到来。

# 处理流程
1. 通读输入文本。
2. 标出上述所有 AI 模式实例。
3. 重写每个有问题片段，保持核心信息与预期语调一致。
4. 注入真实个性与观点（适当使用"我"，承认复杂性，允许一些自然的杂乱）。
5. 输出人性化版本。

# 输出格式
只输出改写后的文本本身，不要解释、不要 Markdown 代码块围栏、不要前后寒暄。`

function nowIso(): string {
  return new Date().toISOString()
}

// 首次访问时再 seed（此时 DB 一定已就绪；registerIpc 阶段 DB 可能尚未初始化）。
// seed 成功才置位：失败时保留 false，下次 IPC 调用自动重试。
let seeded = false
const SEED_SKILL_NAME = '去 AI 味（humanizer-zh）'
const SEED_FLAG_KEY = 'skill_seed_done'

function ensureSeeded() {
  if (seeded) return
  try {
    const db = getDb()
    // 种子只写一次，标记放在 app_meta（用户删技能删不到的地方）。
    // 早期版本按「ai_skills 表是否为空」判断，用户删光技能后主进程一重启
    // （dev 下改代码即重启）就会重新种入，表现为"删不掉"。
    const flag = db.select().from(appMeta).where(eq(appMeta.key, SEED_FLAG_KEY)).get()
    if (flag) {
      seeded = true
      return
    }
    const existing = db.select().from(aiSkills).where(eq(aiSkills.name, SEED_SKILL_NAME)).get()
    if (!existing) {
      const ts = nowIso()
      db.insert(aiSkills).values({
        id: uuidv4(),
        name: SEED_SKILL_NAME,
        description: '去除 AI 生成文本的痕迹，使文字更自然、更像人类书写。在编辑器选中文本后调用。',
        prompt: HUMANIZER_ZH_PROMPT,
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
      }).run()
    }
    db.insert(appMeta).values({ key: SEED_FLAG_KEY, value: nowIso(), updatedAt: nowIso() })
      .onConflictDoNothing()
      .run()
    seeded = true
  } catch (e) {
    // seed 失败不应阻断主流程，但要留痕便于排查
    console.error('[skill] 种子技能写入失败（下次调用会重试）:', e)
  }
}

export function registerSkillIpc() {
  // 列出技能
  ipcMain.handle('skill:list', (_event, opts?: { includeDisabled?: boolean }) => {
    ensureSeeded()
    const db = getDb()
    const rows = opts?.includeDisabled
      ? db.select().from(aiSkills).all()
      : db.select().from(aiSkills).where(eq(aiSkills.enabled, true)).all()
    return rows
  })

  // 新增技能
  ipcMain.handle('skill:create', (_event, data: { name: string; description?: string; prompt: string; enabled?: boolean }) => {
    if (!data?.name || !data?.prompt) return { success: false, error: 'name 与 prompt 必填' }
    const db = getDb()
    const id = uuidv4()
    const ts = nowIso()
    db.insert(aiSkills).values({
      id,
      name: data.name,
      description: data.description ?? '',
      prompt: data.prompt,
      enabled: data.enabled ?? true,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return { success: true, id }
  })

  // 更新技能
  ipcMain.handle('skill:update', (_event, data: { id: string; name?: string; description?: string; prompt?: string; enabled?: boolean }) => {
    if (!data?.id) return { success: false, error: 'id 必填' }
    const db = getDb()
    const existing = db.select().from(aiSkills).where(eq(aiSkills.id, data.id)).get()
    if (!existing) return { success: false, error: '技能不存在' }
    const patch: Record<string, any> = { updatedAt: nowIso() }
    if (data.name !== undefined) patch.name = data.name
    if (data.description !== undefined) patch.description = data.description
    if (data.prompt !== undefined) patch.prompt = data.prompt
    if (data.enabled !== undefined) patch.enabled = data.enabled
    db.update(aiSkills).set(patch).where(eq(aiSkills.id, data.id)).run()
    return { success: true }
  })

  // 删除技能
  ipcMain.handle('skill:delete', (_event, id: string) => {
    if (!id) return { success: false, error: 'id 必填' }
    const db = getDb()
    db.delete(aiSkills).where(eq(aiSkills.id, id)).run()
    return { success: true }
  })

  // 用技能处理文本
  ipcMain.handle('skill:invoke', async (_event, data: {
    skillId: string
    content: string
    modelId?: string | null
    bookId?: string | null
    bookTitle?: string | null
  }) => {
    ensureSeeded()
    const db = getDb()
    const skill = db.select().from(aiSkills).where(eq(aiSkills.id, data.skillId)).get()
    if (!skill) return { success: false, error: '技能不存在' }
    if (!skill.prompt) return { success: false, error: '技能未配置提示词' }
    const text = (data?.content || '').trim()
    if (!text) return { success: false, error: '待处理文本为空' }

    // 解析模型：优先用传入 modelId，否则取第一个启用的模型兜底
    let modelRow = data.modelId ? db.select().from(modelProviders).where(eq(modelProviders.id, data.modelId)).get() : null
    if (!modelRow) modelRow = db.select().from(modelProviders).where(eq(modelProviders.enabled, true)).limit(1).get()
    if (!modelRow) return { success: false, error: '未配置任何模型' }
    const model = decodeModelApiKey(modelRow)
    if (!model.apiKey || !model.modelName) return { success: false, error: '模型 API Key 或模型名称未配置' }
    // 强校验：模型未配置计费规则则直接抛错，避免"未预估成本就调用"
    try {
      assertBillingRulesConfigured(modelRow)
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }

    // 统一记账：只要 provider 返回了真实 usage 就落 token_usage_logs（口径与聊天室 / 剧情预演一致），
    // 截断 / 出错但已产生消耗的调用也必须记，否则主菜单消耗汇总少钱。
    const recordUsage = (usageRaw: any, responseText: string) => {
      const usage = normalizeRawUsage(usageRaw)
      if (!hasUsableUsage(usage)) return
      insertTokenLog({
        modelId: model.id,
        action: `技能处理 · ${skill.name}`,
        contextType: 'skill',
        usage,
        cost: computeUsageCost(usage, model),
        bookId: data.bookId ?? null,
        bookTitle: data.bookTitle ?? null,
        systemRequestText: skill.prompt,
        userRequestText: text,
        responseText,
      })
    }

    try {
      const result = await runAgentModel({
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelName: model.modelName,
        messages: [
          { role: 'system', content: skill.prompt },
          { role: 'user', content: text },
        ],
        // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 技能处理内置默认 0.6
        ...resolveSamplingParams(modelRow, 'skill'),
        stream: true,
        mergeSystemMessages: model.mergeSystemMessages,
      })
      recordUsage(result.usage, result.content || '')
      return { success: true, content: result.content }
    } catch (e: any) {
      if (e instanceof AgentModelError && e.partialResult) {
        recordUsage(e.partialResult.usage, e.partialResult.content || '')
      }
      return { success: false, error: e?.message || String(e) }
    }
  })

  // GitHub / 任意文本链接导入：下载并解析为技能草稿（不入库，前端预览确认后逐个 skill:create）
  ipcMain.handle('skill:importFromUrl', async (_event, data: { url: string }) => {
    const url = (data?.url || '').trim()
    if (!url) return { success: false, error: '请粘贴技能链接' }
    try {
      const drafts = await collectSkillDraftsFromUrl(url)
      return { success: true, drafts }
    } catch (e: any) {
      console.error('[skill:importFromUrl] 导入失败:', e)
      return { success: false, error: e?.message || String(e) }
    }
  })

  // Zip 压缩包导入：主进程内存解包解析（不落盘）
  ipcMain.handle('skill:importZip', (_event, buffer: Uint8Array) => {
    try {
      if (!buffer || !buffer.length) return { success: false, error: '压缩包内容为空' }
      const drafts = collectSkillDraftsFromZip(Buffer.from(buffer))
      return { success: true, drafts }
    } catch (e: any) {
      console.error('[skill:importZip] 导入失败:', e)
      return { success: false, error: e?.message || String(e) }
    }
  })
}
