/**
 * 文风指纹提取器
 *
 * 职责：把 1~N 篇范本纯文本统计成量化特征 StyleMetrics。
 * 全程本地纯算法，不调模型、零 token 成本、可复现。
 *
 * 统计维度：
 *   1. 句式层：平均句长 / 中位句长 / 短句占比 / 长句占比 / 句长标准差 / 单句最长
 *   2. 段落层：平均段落长度
 *   3. 对话/叙述：对话字符占比 / 叙述字符占比
 *   4. 标点习惯：破折号 / 省略号 / 分号 / 逗号 频次（每千字）
 *   5. 用词丰富度：2-gram type-token ratio（中文近似分词，比单字 TTR 更稳）
 *   6. AI 套路词命中：LLM 中文写作的高频套路词清单 + 命中密度
 *
 * 与 summary 生成器、auditor 配合：
 *   extract → metrics → summary(模型) → 注入；正文 → audit(metrics) → 吻合度分数。
 */

/** 量化文风特征 */
export type StyleMetrics = {
  // —— 样本量 ——
  totalChars: number // 去空白后总字符数（统计基准）
  totalSentences: number
  totalParagraphs: number

  // —— 句式层 ——
  avgSentenceLength: number // 平均句长（字符/句，去标点）
  medianSentenceLength: number // 中位句长
  shortSentenceRatio: number // 短句占比（≤14 字）
  longSentenceRatio: number // 长句占比（≥40 字）
  maxSentenceLength: number
  sentenceLengthStd: number // 句长标准差（句式是否单一）

  // —— 段落层 ——
  avgParagraphLength: number // 平均段落长度（字符/段，去空白）

  // —— 对话 / 叙述 ——
  dialogueRatio: number // 对话字符占总字符比（0~1）
  narrationRatio: number // 叙述字符比（1 - dialogueRatio，近似）

  // —— 标点习惯（每千字频次）——
  dashFreq: number // 破折号 ——
  ellipsisFreq: number // 省略号 ……
  semicolonFreq: number // 分号 ；
  commaFreq: number // 逗号 ，

  // —— 用词丰富度 ——
  typeTokenRatio: number // 2-gram TTR（0~1，越高越多样）

  // —— AI 套路词命中 ——
  aiClicheHits: Array<{ category: string; word: string; count: number }>
  aiClicheDensity: number // 套路词总命中数 / 千字
}

/** AI 中文写作高频套路词清单（按类别分组，便于展示） */
export const AI_CLICHE_GROUPS: Array<{ category: string; words: string[] }> = [
  {
    category: '情绪外化',
    words: ['涌起', '涌上心头', '心头涌起', '心中涌起', '漾起', '荡起', '泛起', '升腾', '蔓延', '弥散'],
  },
  {
    category: '不由自主',
    words: ['不禁', '不由得', '不由自主', '情不自禁', '下意识', '脱口而出'],
  },
  {
    category: '比喻泛滥',
    words: ['仿佛', '宛如', '犹如', '恍若', '宛若', '好似', '有如', '恍如'],
  },
  {
    category: '刻意诗意',
    words: ['一抹', '一缕', '一丝', '一寸', '一泓', '一汪', '几分', '些许', '半分'],
  },
  {
    category: '神态套路',
    words: [
      '嘴角微微上扬', '嘴角勾起', '嘴角扬起', '嘴角微微', '唇角', '薄唇',
      '眼底闪过', '眸中闪过', '眸光', '眸色', '眼底', '目光深邃', '目光灼灼',
      '眉头微蹙', '眉峰微挑', '勾唇', '扯出', '扯起',
    ],
  },
  {
    category: '氛围凝固',
    words: ['空气仿佛凝固', '时间仿佛静止', '气氛变得', '鸦雀无声', '针落可闻', '凝滞'],
  },
  {
    category: '开口套路',
    words: ['缓缓开口', '淡淡地说', '轻声道', '沉声道', '低声道', '低声说'],
  },
  {
    category: '程度堆砌',
    words: ['极其', '格外', '异常', '分外', '尤为', '无比', '十分', '甚是'],
  },
]

/** 扁平化的套路词清单（供命中统计用） */
const AI_CLICHE_FLAT: Array<{ category: string; word: string }> = AI_CLICHE_GROUPS.flatMap(
  (g) => g.words.map((w) => ({ category: g.category, word: w })),
)

// ─── 文本工具 ─────────────────────────────────────────────

/** 统计 substring 在文本中出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/** 去除所有空白字符（空格/制表/换行/全角空格），用于字符总数统计 */
function stripWhitespace(text: string): string {
  return text.replace(/[\s\u3000]/g, '')
}

/** 中文分句：按句末标点 。！？…… 切分，保留句子纯文本（去标点） */
function splitSentences(text: string): string[] {
  // 先把省略号 …… / …… 统一看作句末；按 [。！？\n] 以及连续省略号切分
  const normalized = text.replace(/\r/g, '')
  // 按句末标点切分（含换行作为软断句）
  const raw = normalized.split(/[。！？!?…\n]+/)
  return raw
    .map((s) => stripWhitespace(s))
    .filter((s) => s.length > 0)
}

/** 段落切分（按一个以上空行切分） */
function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n+/)
    .map((p) => stripWhitespace(p))
    .filter((p) => p.length > 0)
}

/** 提取所有对话文本（中文引号 / 直引号 / 「」） */
function extractDialogue(text: string): string {
  const matches: string[] = []
  // 中文弯引号 “…” / 直引号 "…" / 日式 「…」
  const re = /[“"][^“”"”]*[”"]|[「][^「」]*[」]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length > 2) {
      // 去掉首尾引号
      matches.push(m[0].slice(1, -1))
    }
  }
  return matches.join('')
}

/** 2-gram type-token ratio（中文近似分词，比单字 TTR 更稳定） */
function bigramTTR(text: string): number {
  const clean = stripWhitespace(text)
  if (clean.length < 4) return 0
  const grams: string[] = []
  const set = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2)
    grams.push(g)
    set.add(g)
  }
  if (grams.length === 0) return 0
  return set.size / grams.length
}

/** 中位数 */
function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 标准差 */
function std(nums: number[]): number {
  if (nums.length === 0) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}

// ─── 主提取 ─────────────────────────────────────────────

/**
 * 从多段范本中提取量化文风特征。
 * @param samples 范本列表，每项含 content（纯文本）
 */
export function extractMetrics(samples: Array<{ content: string }>): StyleMetrics {
  const fullText = samples.map((s) => s.content || '').join('\n\n')
  const cleanText = stripWhitespace(fullText)
  const totalChars = cleanText.length

  const sentences = splitSentences(fullText)
  const sentenceLengths = sentences.map((s) => s.length)
  const totalSentences = Math.max(sentences.length, 1)

  const paragraphs = splitParagraphs(fullText)
  const totalParagraphs = Math.max(paragraphs.length, 1)
  const paragraphLengths = paragraphs.map((p) => p.length)

  const dialogueText = extractDialogue(fullText)
  const dialogueChars = stripWhitespace(dialogueText).length
  const dialogueRatio = totalChars > 0 ? dialogueChars / totalChars : 0

  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0
  const shortCount = sentenceLengths.filter((l) => l <= 14).length
  const longCount = sentenceLengths.filter((l) => l >= 40).length

  // 标点频次（每千字）
  const perK = (n: number) => (totalChars > 0 ? (n / totalChars) * 1000 : 0)
  const fullRaw = fullText // 标点统计用原始文本（含换行无妨，分母用去空白字符数）

  // AI 套路词命中
  const aiClicheHits: Array<{ category: string; word: string; count: number }> = []
  let aiClicheTotal = 0
  for (const { category, word } of AI_CLICHE_FLAT) {
    const c = countOccurrences(fullText, word)
    if (c > 0) {
      aiClicheHits.push({ category, word, count: c })
      aiClicheTotal += c
    }
  }

  return {
    totalChars,
    totalSentences: sentences.length,
    totalParagraphs: paragraphs.length,

    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    medianSentenceLength: Math.round(median(sentenceLengths) * 10) / 10,
    shortSentenceRatio: Math.round((shortCount / totalSentences) * 100) / 100,
    longSentenceRatio: Math.round((longCount / totalSentences) * 100) / 100,
    maxSentenceLength: sentenceLengths.length > 0 ? Math.max(...sentenceLengths) : 0,
    sentenceLengthStd: Math.round(std(sentenceLengths) * 10) / 10,

    avgParagraphLength: Math.round(
      (paragraphLengths.reduce((a, b) => a + b, 0) / totalParagraphs) * 10,
    ) / 10,

    dialogueRatio: Math.round(dialogueRatio * 100) / 100,
    narrationRatio: Math.round((1 - dialogueRatio) * 100) / 100,

    dashFreq: Math.round(perK(countOccurrences(fullRaw, '——')) * 10) / 10,
    ellipsisFreq: Math.round(perK(countOccurrences(fullRaw, '……')) * 10) / 10,
    semicolonFreq: Math.round(perK(countOccurrences(fullRaw, '；')) * 10) / 10,
    commaFreq: Math.round(perK(countOccurrences(fullRaw, '，')) * 10) / 10,

    typeTokenRatio: Math.round(bigramTTR(fullText) * 1000) / 1000,

    aiClicheHits,
    aiClicheDensity: Math.round(perK(aiClicheTotal) * 100) / 100,
  }
}

// ─── 可读描述（供 summary 生成器与 UI 展示）─────────────

/**
 * 把 metrics 转成人类可读的统计要点（用于喂给模型生成自然语言约束摘要）。
 */
export function metricsToReadable(m: StyleMetrics): string {
  const lines: string[] = []
  lines.push(`样本量：${m.totalChars} 字，${m.totalSentences} 句，${m.totalParagraphs} 段`)
  lines.push(
    `句式：平均句长 ${m.avgSentenceLength} 字，中位 ${m.medianSentenceLength} 字，` +
      `短句(≤14字)占比 ${(m.shortSentenceRatio * 100).toFixed(0)}%，` +
      `长句(≥40字)占比 ${(m.longSentenceRatio * 100).toFixed(0)}%，` +
      `单句最长 ${m.maxSentenceLength} 字，句长标准差 ${m.sentenceLengthStd}`,
  )
  lines.push(`段落：平均段长 ${m.avgParagraphLength} 字`)
  lines.push(
    `对话/叙述：对话占比 ${(m.dialogueRatio * 100).toFixed(0)}%，叙述占比 ${(m.narrationRatio * 100).toFixed(0)}%`,
  )
  lines.push(
    `标点习惯（每千字）：破折号 ${m.dashFreq}，省略号 ${m.ellipsisFreq}，分号 ${m.semicolonFreq}，逗号 ${m.commaFreq}`,
  )
  lines.push(`用词丰富度（2-gram TTR）：${m.typeTokenRatio}`)
  if (m.aiClicheHits.length > 0) {
    const top = [...m.aiClicheHits].sort((a, b) => b.count - a.count).slice(0, 12)
    lines.push(
      `AI 套路词命中（密度 ${m.aiClicheDensity}/千字）：` +
        top.map((h) => `${h.word}×${h.count}`).join('、'),
    )
  } else {
    lines.push(`AI 套路词命中：无`)
  }
  return lines.join('\n')
}
