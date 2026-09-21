/**
 * 应用钩子
 *
 * 职责：
 * 1. 把 PendingWrite 应用到数据库（用户点"应用"后调用）
 * 2. 写正文应用后自动触发快照生成
 * 3. 快照应用时自动分析关键角色/场景/地点存入数据库
 *
 * 注意：不直接暴露给模型，由 IPC 层调用
 */

import { eq, and, asc, desc } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { books, volumes, chapters, outlines, bookSettingEntries, chapterSnapshots, timelineClips, modelProviders } from '../db/schema'
import { SETTING_TYPE_LABELS } from './settings-labels'
import { v4 as uuidv4 } from 'uuid'
import { runAgentModel } from './model-caller'
import { resolveSamplingParams } from '../utils/sampling'
import type { PendingWrite, ToolContext } from './types'
import type { DecodedModel } from '../ipc/model.ipc'
import { decodeModelApiKey } from '../ipc/model.ipc'
import { cleanEditorContentFromAi } from '../ipc/data-block-parser'
import { loadBookMemory, saveBookMemoryWithVersion } from './memory'
import { mergeIntoBookMemory } from './memory/merger'
import { assertBillingRulesConfigured } from '../utils/billing'

/** 应用结果 */
export type ApplyResult = {
  success: boolean
  message: string
  /** 应用后产生的副作用（如自动触发的快照） */
  sideEffects?: string[]
  /** 创建的实体 ID（如新书的 ID） */
  createdId?: string
}

/**
 * 应用单个 PendingWrite 到数据库
 */
export async function applyPendingWrite(write: PendingWrite, modelId?: string, onReasoning?: (delta: string) => void): Promise<ApplyResult> {
  const db = getDb()
  const ts = new Date().toISOString()
  const sideEffects: string[] = []

  try {
    switch (write.type) {
      // ─── 书籍信息 ────────────────────────────
      case 'book_info': {
        if (write.applyMode === 'insert') {
          // 创建新书
          const bookId = uuidv4()
          db.insert(books).values({
            id: bookId,
            title: write.data.title || '未命名',
            description: write.data.description || '',
            detail: write.data.detail || '',
            writingStyle: write.data.writingStyle || '',
            writingPov: write.data.writingPov || '',
            writingConstraint: write.data.writingConstraint || '',
            cover: null,
            writingWordCountTarget: '',
            writingTaboo: '',
            createdAt: ts,
            updatedAt: ts,
          }).run()
          return { success: true, message: `书籍《${write.data.title}》已创建`, sideEffects, createdId: bookId }
        } else {
          // 更新书籍
          const bookId = write.target.bookId!
          db.update(books).set({ ...write.data, updatedAt: ts }).where(eq(books.id, bookId)).run()
          return { success: true, message: `书籍已更新`, sideEffects }
        }
      }

      // ─── 书籍大纲 ────────────────────────────
      case 'book_outline': {
        const bookId = write.target.bookId!
        const existing = db.select().from(outlines).where(and(eq(outlines.bookId, bookId), eq(outlines.type, 'book'))).get()
        if (existing) {
          const newContent = write.applyMode === 'append' ? (existing.content + '\n\n' + write.data.content) : write.data.content
          db.update(outlines).set({ content: newContent, updatedAt: ts }).where(eq(outlines.id, existing.id)).run()
        } else {
          db.insert(outlines).values({
            id: uuidv4(),
            bookId,
            type: 'book',
            targetId: null,
            content: write.data.content,
            updatedAt: ts,
          }).run()
        }
        return { success: true, message: '书籍大纲已保存', sideEffects }
      }

      // ─── 分卷列表 ────────────────────────────
      case 'volume_list': {
        const bookId = write.target.bookId!
        const items = write.data.items || []
        const maxSort = db.select().from(volumes).where(eq(volumes.bookId, bookId)).all()
        let sortOrder = maxSort.length
        for (const item of items) {
          db.insert(volumes).values({
            id: uuidv4(),
            bookId,
            title: item.title || '未命名分卷',
            description: item.description || '',
            outline: item.outline || '',
            sortOrder: sortOrder++,
          }).run()
        }
        return { success: true, message: `已创建 ${items.length} 个分卷`, sideEffects }
      }

      // ─── 分卷大纲 ────────────────────────────
      case 'volume_outline': {
        const volumeId = write.target.volumeId!
        db.update(volumes).set({ outline: write.data.outline }).where(eq(volumes.id, volumeId)).run()
        return { success: true, message: '分卷大纲已更新', sideEffects }
      }

      // ─── 分卷信息（标题/简介） ────────────────
      case 'volume_info': {
        const volumeId = write.target.volumeId!
        const updates: Record<string, any> = {}
        if (write.data.title !== undefined) updates.title = write.data.title
        if (write.data.description !== undefined) updates.description = write.data.description
        db.update(volumes).set(updates).where(eq(volumes.id, volumeId)).run()
        return { success: true, message: '分卷信息已更新', sideEffects }
      }

      // ─── 章节列表 ────────────────────────────
      case 'chapter_list': {
        const bookId = write.target.bookId!
        const items = write.data.items || []
        const existing = db.select().from(chapters).where(eq(chapters.bookId, bookId)).all()
        let sortOrder = existing.length
        for (const item of items) {
          db.insert(chapters).values({
            id: uuidv4(),
            bookId,
            volumeId: item.volumeId || null,
            title: item.title || '未命名章节',
            summary: item.summary || '',
            outline: item.outline || '',
            content: '',
            wordCount: 0,
            status: 'draft',
            sortOrder: sortOrder++,
            createdAt: ts,
            updatedAt: ts,
          }).run()
        }
        return { success: true, message: `已创建 ${items.length} 个章节`, sideEffects }
      }

      // ─── 章节大纲 ────────────────────────────
      case 'chapter_outline': {
        const chapterId = write.target.chapterId!
        db.update(chapters).set({ outline: write.data.outline, updatedAt: ts }).where(eq(chapters.id, chapterId)).run()
        return { success: true, message: '章节大纲已更新', sideEffects }
      }

      // ─── 章节信息（标题/摘要/状态） ────────────
      case 'chapter_info': {
        const chapterId = write.target.chapterId!
        db.update(chapters).set({ ...write.data, updatedAt: ts }).where(eq(chapters.id, chapterId)).run()
        return { success: true, message: '章节信息已更新', sideEffects }
      }

      // ─── 章节正文 ────────────────────────────
      case 'chapter_content': {
        const chapterId = write.target.chapterId!
        const ch = db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
        if (!ch) return { success: false, message: '章节不存在' }

        // 兜底：模型偶尔会在正文里带上章节标题、"一、二、三、四"分段小标题、"本章完"等尾巴，
        // 落库前统一清洗一次。cleanEditorContentFromAi 内部处理了 3 类残留。
        const rawFromAi = write.data.content || ''
        const cleaned = cleanEditorContentFromAi(rawFromAi, ch.title)
        let newContent = cleaned
        if (write.applyMode === 'append') {
          newContent = ch.content + (ch.content ? '\n\n' : '') + cleaned
        }
        const wordCount = newContent.replace(/\s/g, '').length
        db.update(chapters).set({ content: newContent, wordCount, status: 'completed', updatedAt: ts }).where(eq(chapters.id, chapterId)).run()

        // 快照生成已改为手动：仅在用户点击正文编辑器的"定稿"按钮时才通过 ai:generateSnapshot 生成。
        // 这里不再自动跑快照——因为自动跑没有对应聊天记录来"记录动作"，且和「定稿」流程重复。

        return { success: true, message: `章节正文已${write.applyMode === 'append' ? '续写' : '保存'}（${wordCount} 字）`, sideEffects }
      }

      // ─── 设定条目 ────────────────────────────
      case 'book_setting': {
        const bookId = write.target.bookId!
        const type = write.data.type
        const items = write.data.items || []
        for (const item of items) {
          db.insert(bookSettingEntries).values({
            id: uuidv4(),
            bookId,
            type,
            name: item.name || '未命名',
            description: item.description || '',
            detail: item.detail || '',
            createdAt: ts,
            updatedAt: ts,
          }).run()
        }
        return { success: true, message: `已创建 ${items.length} 个${SETTING_TYPE_LABELS[type] || type}`, sideEffects }
      }

      // ─── 设定条目更新 ────────────────────────
      case 'setting_info': {
        const settingId = write.target.settingId!
        db.update(bookSettingEntries).set({ ...write.data, updatedAt: ts }).where(eq(bookSettingEntries.id, settingId)).run()
        return { success: true, message: '设定条目已更新', sideEffects }
      }

      // ─── 删除实体 ────────────────────────────
      case 'delete_entity': {
        const entityType = write.target.entityType
        const ids = write.target.entityIds || []
        for (const id of ids) {
          if (entityType === 'book') {
            db.delete(books).where(eq(books.id, id)).run()
          } else if (entityType === 'volume') {
            db.delete(volumes).where(eq(volumes.id, id)).run()
          } else if (entityType === 'chapter') {
            db.delete(chapters).where(eq(chapters.id, id)).run()
          } else if (entityType === 'setting') {
            db.delete(bookSettingEntries).where(eq(bookSettingEntries.id, id)).run()
          }
        }
        return { success: true, message: `已删除 ${ids.length} 项`, sideEffects }
      }

      // ─── 章节快照 ────────────────────────────
      case 'chapter_snapshot': {
        const chapterId = write.data.chapterId
        const ch = db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
              if (!ch) return { success: false, message: '章节不存在' }
        if (!ch.content) return { success: false, message: '章节无正文内容，无法生成快照' }

        // 优先路径：write.data 里已带上工具阶段算好的 snapshotData/clips，直接落库
        // 这是 generate_snapshot 工具的正规路径，保证"结果确认"弹窗看到的就是最终入库的内容。
        if (write.data.snapshotData && Array.isArray(write.data.clips)) {
          await persistChapterSnapshot(ch.bookId, chapterId, {
            snapshotData: write.data.snapshotData,
            clips: write.data.clips,
          })
        } else {
          // 兜底路径（工具阶段没算过的旧数据）：应用时再实时跑一次模型
          if (!modelId) return { success: false, message: '未指定模型，无法生成快照' }
          await generateChapterSnapshot(ch.bookId, chapterId, ch.content, modelId, onReasoning)
        }

        // 定稿收尾：把章节状态置为 finalized（这是"定稿"流程的最后一步）
        db.update(chapters).set({ status: 'finalized', updatedAt: ts }).where(eq(chapters.id, chapterId)).run()

        // 广播事件，让 Editor/Timeline 等页面刷新章节列表与快照下拉
        try {
          const mainWindow = BrowserWindow.getAllWindows()[0]
          if (mainWindow) {
            mainWindow.webContents.send('ai:snapshotGenerated', {
              chapterId,
              success: true,
            })
          }
        } catch {}

        return { success: true, message: '快照已生成，章节已定稿', sideEffects }
      }

      default:
        return { success: false, message: `未知操作类型: ${write.type}` }
    }
  } catch (err: any) {
    return { success: false, message: err?.message || '应用失败' }
  }
}

/**
 * 生成章节快照（两步模型调用）
 *
 * Step 1: 识别 clips（出场实体的段落位置）
 * Step 2: 提取详细状态（角色状态、地点、事件、伏笔）
 * 落库: 保存快照 + clips + 跨章链接
 */
async function generateChapterSnapshot(bookId: string, chapterId: string, chapterContent: string, modelId: string, onReasoning?: (delta: string) => void) {
  const computed = await computeChapterSnapshot(bookId, chapterId, chapterContent, modelId, undefined, onReasoning)
  await persistChapterSnapshot(bookId, chapterId, computed)
}

/**
 * 只跑两次模型算出 snapshotData 和 clips，不做任何落库操作。
 * 用途：generate_snapshot 工具需要在【应用前】把数据展示给用户审核，因此把计算和落库解耦。
 */
export async function computeChapterSnapshot(
  bookId: string,
  chapterId: string,
  chapterContent: string,
  modelId: string,
  onSubModelCall?: ToolContext['onSubModelCall'],
  onReasoning?: (delta: string) => void,
) {
  const db = getDb()

  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) throw new Error('章节不存在')

  // 上一章快照
  let previousSnapshotData: any = null
  const prevChapter = db.select().from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.sortOrder, chapter.sortOrder - 1)))
    .get()
  if (prevChapter) {
    const prevSnapshot = db.select().from(chapterSnapshots)
      .where(eq(chapterSnapshots.chapterId, prevChapter.id))
      .orderBy(desc(chapterSnapshots.createdAt))
      .limit(1)
      .get()
    if (prevSnapshot?.snapshotData) {
      try { previousSnapshotData = JSON.parse(prevSnapshot.snapshotData) } catch {}
    }
  }

  // 设定表
  const bookSettings = db.select().from(bookSettingEntries).where(eq(bookSettingEntries.bookId, bookId)).all()

  // 解析模型
  const modelRow = db.select().from(modelProviders).where(eq(modelProviders.id, modelId)).get()
  const model = decodeModelApiKey(modelRow)
  if (!modelRow || !model || !model.apiKey || !model.modelName) throw new Error('模型配置不完整')
  // 强校验：模型未配置计费规则则直接抛错，避免"未预估成本就调用"
  assertBillingRulesConfigured(modelRow)

  // 快照分析师配置（硬编码）
  const snapshotSystemPrompt = [
    '你是记忆分析师：基于本章正文 + 上一章总记忆 + 设定表，产出**本章的单章记忆**（结构化 JSON）。',
    '',
    '# 首要目标',
    '你的输出会作为下一章写手的"接续基准"，因此必须做到：',
    '1. 覆盖本章正文中出现的所有角色、地点、场景、物品、技能、势力、体系、事件、伏笔、灵感。',
    '2. 每个角色都要输出**完整档案**（originalSetting / personality / growthArc / vector / state），不允许只写"状态"。',
    '3. **持续继承**上一章总记忆的原始设定、性格、成长弧、向量、持有物、已知技能，除非本章正文明确出现变化。',
    '4. 关键状态（受伤、心境、位置、持有物）必须与正文完全一致，不得幻想。',
    '',
    '# 上下文说明',
    '- 系统会把"上一章的总记忆（book_memory.data）"作为上下文一并提供。把它视作"截至上一章末尾的全书事实"。',
    '- 系统还会提供本章正文全文。你在正文里看到什么就写什么；正文没提到但上一章有的信息（如角色的原始设定、持有物），要**继承**下来。',
    '',
    '# 关键行为约束',
    '- originalSetting 恒定：一旦上一章总记忆里给某角色写过原始设定，必须逐字复述，禁止改写。',
    '- 5 维立场向量必填：loyalty / aggression / rationality / trust / morality 每个都是 0-100 的整数。',
    '- holds（持有物）默认继承：本章没明确"丢弃/送出/使用消耗/被夺走"就要沿用上一章的 holds。',
    '- 地点 = 在哪：物理空间、地理锚点（如"望舒号""NG-7293外围航道""城北老街"）。场景 = 发生什么画面、故事：戏剧情境、叙事片段（如"舰桥争执""深夜密谈""废墟追杀"）。二者严格区分，不得混淆。',
    '- sceneEntities 里必须列出本章所有出现的地点（locations）和场景（scenes），不要只在 currentPlot 里记最后一个。',
    '- 事件(events)的 type 与角色关系(relationships)的 type：必须用【简洁中文短语】（2-6字），例如：对话、战斗、冲突、救援、发现、探索、谈判、背叛、合作、亲密互动、爱恋、敌对、师徒、亲情。若现有词不贴切可自行用中文概括，但【严禁输出英文/拼音/下划线组合】（如不得写 intimate_act、dialogue、home_deception 这类标签，那会无法显示）。',
    '- 只输出 JSON，不要寒暄、不要解释、不要 Markdown 代码块围栏。',
  ].join('\n')

  // ── 合并：原本分两步（Step 1 章节切片 + Step 2 角色状态/伏笔提取）现合并为一步。
  //   clips 字段并入 Step 2 的输出 schema 顶层，模型在同一次调用里同时给出记忆分析与出场切片。
  //   减少一次模型调用，节省 1 次往返时间 + 减少输入 token。

  // ── Step 2 payload: 提取详细状态 ──
  const systemPrompt = snapshotSystemPrompt + '\n\n# 输出格式（必须是合法 JSON，不要 Markdown 代码块，不要多余文字）\n\n输出完整的单章记忆 JSON，严格按以下 schema（字段名、嵌套结构、类型必须完全一致）：\n\n```json\n{\n  "storyTime": "故事时间字符串",\n  "currentPlot": {\n    "lastPlot": "剧情接续点描述",\n    "lastLocation": { "id": "地点ID", "name": "本章末角色在哪（物理空间，如"望舒号""城北老街"，不得填场景名）" },\n    "lastScene": { "id": "场景ID", "name": "本章末发生什么画面、故事（如"舰桥争执""深夜密谈"，不得填地点名）" }\n  },\n  "sceneEntities": {\n    "characters": [{ "id": "实体ID", "name": "实体名称" }],\n    "items": [{ "id": "实体ID", "name": "实体名称" }],\n    "skills": [{ "id": "实体ID", "name": "实体名称" }],\n    "factions": [{ "id": "实体ID", "name": "实体名称" }],\n    "systems": [{ "id": "实体ID", "name": "实体名称" }],\n    "locations": [{ "id": "地点ID", "name": "在哪（物理空间名称）", "description": "地点特征或氛围简述" }],\n    "scenes": [{ "id": "场景ID", "name": "发生什么画面（戏剧情境名称）", "summary": "场景概要" }],\n    "events": [{ "type": "事件类型（简洁中文短语，如：对话/战斗/冲突/亲密互动/背叛，禁止英文/拼音）", "summary": "事件概要", "participants": ["参与实体ID列表"] }]\n  },\n  "characters": [{\n    "id": "角色ID",\n    "name": "角色名称",\n    "originalSetting": "原始设定全文（首次写入后恒定不变）",\n    "personality": "性格描述",\n    "growthArc": "当前成长阶段描述",\n    "vector": { "loyalty": 0-100整数, "aggression": 0-100整数, "rationality": 0-100整数, "trust": 0-100整数, "morality": 0-100整数 },\n    "state": {\n      "location": { "id": "位置ID", "name": "位置名称" },\n      "injury": { "hurt": true或false, "parts": ["受伤部位列表"], "severity": "无|轻伤|中伤|重伤|濒死" },\n      "survival": "健康|疲惫|受伤|濒死|死亡|失踪",\n      "mood": "心境描述",\n      "speechStyle": "说话风格描述",\n      "knownSkills": [{ "id": "技能ID", "name": "技能名称" }],\n      "holds": [{ "id": "物品ID", "name": "物品名称" }],\n      "knows": ["线索文本列表"],\n      "relationships": [{ "targetId": "对方ID", "targetName": "对方名称", "type": "关系类型（简洁中文，如：爱恋/敌对/师徒/合作，禁止英文/拼音）", "value": -100到100的整数 }]\n    }\n  }],\n  "foreshadowing": [{\n    "id": "伏笔ID",\n    "description": "伏笔描述",\n    "action": "planted（未回收）|developing（推进中）|resolved（已回收）",\n    "significance": "low|medium|high|critical",\n    "relatedCharacters": ["相关角色ID列表"]\n  }],\n  "inspirationsUsed": [{ "id": "灵感ID", "name": "灵感名称" }],\n  "clips": [{\n    "entityId": "设定表中的id，未找到填空字符串",\n    "entityName": "实体名称",\n    "clipType": "character | location | scene",\n    "paragraphStart": "段落索引(从0开始)",\n    "paragraphEnd": "段落索引(包含)",\n    "status": "出场|退场|持续"\n  }]\n}\n\n\n# 补充要求：clips 出场切片\n你同时也是章节切片分析师，需要在 `clips` 数组中输出本章所有出场实体的段落位置。规则：\n- `clips` 与上方 schema 顶层字段同级，必须真实分析正文，不要留空数组（除非本章无任何出场）。\n- `paragraphStart` / `paragraphEnd` 是用户提示词中以 `段落 N:` 标号的段落索引，从 0 开始，`paragraphEnd` 包含在内。\n- `clipType` 取值：`character`（角色）/ `location`（地点，物理空间，如"望舒号""城北老街"，不得填场景名）/ `scene`（场景，发生什么画面、故事，如"舰桥争执""深夜密谈"，不得填地点名）。\n- `status` 取值：`出场`（该实体在此段落首次登场）/ `退场`（该实体在此段落之后退出舞台）/ `持续`（该实体在此段落区间内持续在场）。\n- `entityId` 必须在设定表中找得到；找不到则填空字符串。\n- 一个实体在一章内可能有多段出场区间，按顺序追加多条 clip 即可。\n\n```\n\n只输出纯 JSON，不要 Markdown 代码块围栏，不要任何解释文字。'

  // 读取当前书籍的"总记忆"，作为分析师的接续基准。
  // 分析师会据此把 originalSetting / holds / knownSkills 等"跨章持续"字段延续下来。
  const totalMemory = loadBookMemory(bookId)
  const hasTotalMemory = totalMemory.characters.length > 0 || totalMemory.plots.length > 0

  // 精简设定表：只保留 id / name / type / 概要，避免把整份长设定文本塞进 prompt
  const compactSettings = bookSettings.map((s: any) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    summary: typeof s.content === 'string' ? s.content.slice(0, 200) : undefined,
  }))

  // 把章节正文按空行 split 成段落，并在每段前加 "段落 N:" 数字号，
  // 让模型可以基于此标号填写 clips 字段里的 paragraphStart / paragraphEnd。
  const paragraphs = chapterContent.split(/\n\n+/).filter((p: string) => p.trim())
  const numberedBody = paragraphs.map((p: string, idx: number) => `段落 ${idx}: ${p}`).join('\n\n')

  const userPrompt = `请分析以下章节正文，产出**本章单章记忆**（结构化 JSON）。

章节标题：${chapter.title}
章节顺序：第 ${chapter.sortOrder + 1} 章

章节正文（段落以空行分隔，已用 \`段落 N:\` 标号，N 从 0 开始）：
${numberedBody}

#上一章的全书总记忆（截至第 ${totalMemory.updatedThroughChapterOrder + 1} 章）#
以下内容作为参考：
${hasTotalMemory ? JSON.stringify(totalMemory, null, 2) : '（暂无历史记忆，这是全书第一次生成记忆）'}

设定表（精简版）：
${JSON.stringify(compactSettings, null, 2)}

请严格按 systemPrompt 定义的 schema 输出单章记忆 JSON，特别注意：
- 已在总记忆里出现过的角色/地点/物品，必须复用其 id 与 originalSetting
- 5 维立场向量所有字段必填
- 持有物 holds 默认继承（除非本章明确移除）`

  // 包装函数：调模型并记录时长/用量（内部两步分析同样流式，思考过程拼接到同一个字符串）
  const trackedCall = async (
    label: string,
    messages: Array<{ role: string; content: string }>,
  ) => {
    const startAt = Date.now()
    const result = await runAgentModel({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelName: model.modelName,
      messages: messages as any,
      // 采样参数：任务自定义（设置 → 任务默认模型参数）> 模型行 > 记忆分析内置默认 0.3（结构化输出，偏确定性）
      ...resolveSamplingParams(model, 'memorySnapshot'),
      stream: true,
      mergeSystemMessages: model.mergeSystemMessages,
    }, { onReasoning })
    const durationMs = Date.now() - startAt
    onSubModelCall?.({
      label,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      output: [{ role: 'assistant', content: result.content }],
      durationMs,
      usage: result.usage,
    })
    return result
  }

  // 单次模型调用：合并后只跑一次，clips 与 snapshotData 一起返回
  const result = await trackedCall('生成章节记忆（含切片）', [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const jsonText = result.content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  const snapshotData: any = JSON.parse(jsonText)
  const clips: any[] = Array.isArray(snapshotData?.clips) ? snapshotData.clips : []

  return { snapshotData, clips }
}

/**
 * 拿到 computeChapterSnapshot 的产物后，把它落库（不再调模型）。
 * 独立出来是为了让工具产出的 pendingWrite 数据在应用时能一比一落库，
 * 让"结果确认"弹窗中审核到的内容跟最终入库的内容完全一致。
 */
export async function persistChapterSnapshot(
  bookId: string,
  chapterId: string,
  data: { snapshotData: any; clips: any[] },
) {
  const db = getDb()
  const ts = new Date().toISOString()

  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) throw new Error('章节不存在')

  // 上一章（用于跨章 prevClipId 链接）
  const prevChapter = db.select().from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.sortOrder, chapter.sortOrder - 1)))
    .get()

  // ── 落库 ──
  const snapshotId = uuidv4()

  try {
    db.insert(chapterSnapshots).values({
      id: snapshotId,
      bookId,
      volumeId: chapter.volumeId || null,
      chapterId,
      chapterOrder: chapter.sortOrder,
      storyTime: data.snapshotData?.storyTime || null,
      snapshotData: JSON.stringify(data.snapshotData),
      isValid: true,
      createdAt: ts,
      updatedAt: ts,
    }).run()
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg.includes('FOREIGN KEY')) {
      throw new Error(
        `[FK] chapter_snapshots insert failed.\n` +
        `  bookId=${bookId}  chapterId=${chapterId}  volumeId=${chapter.volumeId || null}  snapshotId=${snapshotId}\n` +
        `  raw=${msg}`
      )
    }
    throw err
  }

  // 删除旧 clips，重建
  const oldClips = db.select().from(timelineClips).where(eq(timelineClips.chapterId, chapterId)).all()
  for (const oldClip of oldClips) {
    const nextClips = db.select().from(timelineClips).where(eq(timelineClips.prevClipId, oldClip.id)).all()
    for (const nextClip of nextClips) {
      db.update(timelineClips).set({ prevClipId: null, updatedAt: ts }).where(eq(timelineClips.id, nextClip.id)).run()
    }
  }
  db.delete(timelineClips).where(eq(timelineClips.chapterId, chapterId)).run()

  // 创建新 clips + 跨章链接
  for (const clip of data.clips) {
    const clipId = uuidv4()
    let prevClipId: string | null = null

    if (prevChapter && clip.entityId) {
      const lastPrevClip = db.select().from(timelineClips)
        .where(and(eq(timelineClips.chapterId, prevChapter.id), eq(timelineClips.entityId, clip.entityId)))
        .orderBy(desc(timelineClips.paragraphEnd))
        .limit(1)
        .get()
      if (lastPrevClip) {
        prevClipId = lastPrevClip.id
      }
    }

    // 必须先 insert 新 clip（新 row 存在后），再 update 旧 row 的 nextClipId 指向它。
    // 反过来的话，update 时 nextClipId 引用了还不存在的 id，触发 next_clip_id 自引用 FK 失败。
    try {
      db.insert(timelineClips).values({
        id: clipId,
        bookId,
        chapterId,
        clipType: clip.clipType || 'character',
        entityId: clip.entityId || '',
        entityName: clip.entityName || '',
        paragraphStart: clip.paragraphStart || 0,
        paragraphEnd: clip.paragraphEnd || 0,
        status: clip.status || '出场',
        snapshotId,
        prevClipId,
        storylineGroup: 'main',
        createdAt: ts,
        updatedAt: ts,
      }).run()
    } catch (err: any) {
      const msg = String(err?.message || err)
      if (msg.includes('FOREIGN KEY')) {
        throw new Error(
          `[FK] timeline_clips insert failed.\n` +
          `  bookId=${bookId}  chapterId=${chapterId}  snapshotId=${snapshotId}  prevClipId=${prevClipId || 'null'}\n` +
          `  clip=${JSON.stringify(clip)}\n` +
          `  raw=${msg}`
        )
      }
      throw err
    }

    if (prevClipId) {
      db.update(timelineClips).set({ nextClipId: clipId, updatedAt: ts }).where(eq(timelineClips.id, prevClipId)).run()
    }
  }

  // ── 增量合并总记忆（纯代码，不调 AI） ──
  // 单章记忆已写入 chapter_snapshots.snapshotData（新 schema）；
  // 这里读老总记忆 → merger 合并 → 用 saveBookMemoryWithVersion 写回：
  //   ① 更新 book_memory 最新态
  //   ② 同时把"聚合到第 sortOrder 章为止"这一版整份记忆存进 book_memory_versions
  //   → 将来用户删掉某章记忆时可以从这张表 O(1) 跳回上一个稳定版本，不用重放合并。
  try {
    const oldMemory = loadBookMemory(bookId)
    const merged = mergeIntoBookMemory(oldMemory, chapter.sortOrder, data.snapshotData, chapter.title)
    saveBookMemoryWithVersion(merged, chapter.sortOrder)
  } catch (err: any) {
    const msg = String(err?.message || err)
    const bookExists = db.select().from(books).where(eq(books.id, bookId)).get()
    throw new Error(
      `[FK] book_memory merge failed.\n` +
      `  bookId=${bookId}  chapterOrder=${chapter.sortOrder}\n` +
      `  bookExistsInDb=${!!bookExists}\n` +
      `  raw=${msg}`
    )
  }
}
