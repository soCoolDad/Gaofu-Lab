/**
 * 文风指纹校验器
 *
 * 职责：拿 AI 生成的正文，对照指纹的量化特征算"吻合度"。
 *   正文 → extractMetrics → 与指纹 metrics 逐维对照 → 分数 + 偏离项 + 红黄绿
 *
 * 零成本（纯本地算法），在 write_chapter_content 工具阶段算出，
 * 塞进 pendingWrite.preview，让用户在"结果确认卡"上直接看到吻合度。
 */

import { extractMetrics, type StyleMetrics } from './extractor'

export type AuditStatus = 'good' | 'warn' | 'bad'

export type AuditDimension = {
  key: string
  label: string
  /** 指纹值（显示用，已格式化） */
  fingerprintValue: string
  /** 正文实测值（显示用，已格式化） */
  contentValue: string
  /** 偏离度 0~1（越大越偏离） */
  deviation: number
  status: AuditStatus
  /** 说明（给用户看为什么偏） */
  note: string
}

export type AuditResult = {
  /** 0~100，越高越吻合 */
  score: number
  level: 'green' | 'yellow' | 'red'
  dimensions: AuditDimension[]
  /** 一句话总结 */
  summary: string
}

// 各维度权重（合计 100）
const WEIGHTS = {
  aiCliche: 30,
  sentenceLength: 20,
  dialogueRatio: 15,
  punctuation: 15,
  shortRatio: 10,
  ttr: 10,
}

/** 相对偏离：|a-b| / max(|b|, eps)，裁剪到 1 */
function relDev(a: number, b: number, eps = 0.01): number {
  return Math.min(Math.abs(a - b) / Math.max(Math.abs(b), eps), 1)
}

/** 绝对偏离：|a-b| / scale，裁剪到 1 */
function absDev(a: number, b: number, scale: number): number {
  return scale > 0 ? Math.min(Math.abs(a - b) / scale, 1) : 0
}

function statusFromDev(dev: number): AuditStatus {
  if (dev < 0.25) return 'good'
  if (dev < 0.5) return 'warn'
  return 'bad'
}

/**
 * 对照指纹校验正文吻合度。
 * @param fingerprint 指纹的量化特征
 * @param content 待校验正文（纯文本）
 */
export function auditContent(fingerprint: StyleMetrics, content: string): AuditResult {
  const contentMetrics = extractMetrics([{ content }])
  const dims: AuditDimension[] = []

  // —— AI 套路词（反向：正文越低越好；正文比指纹高即扣分）——
  const clicheExcess = Math.max(0, contentMetrics.aiClicheDensity - fingerprint.aiClicheDensity)
  // 指纹几乎无套路词时，正文每千字多出 3 个即严重偏离
  const clicheDev = Math.min(clicheExcess / 3, 1)
  const clicheHitWords = contentMetrics.aiClicheHits
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((h) => `${h.word}×${h.count}`)
    .join('、')
  dims.push({
    key: 'aiCliche',
    label: 'AI 套路词',
    fingerprintValue: `${fingerprint.aiClicheDensity}/千字`,
    contentValue: `${contentMetrics.aiClicheDensity}/千字`,
    deviation: clicheDev,
    status: statusFromDev(clicheDev),
    note:
      clicheExcess > 0
        ? `正文比范本多 ${clicheExcess.toFixed(1)}/千字套路词${clicheHitWords ? '：' + clicheHitWords : ''}`
        : '正文套路词密度未超过范本，良好',
  })

  // —— 平均句长 ——
  const slDev = relDev(contentMetrics.avgSentenceLength, fingerprint.avgSentenceLength)
  dims.push({
    key: 'sentenceLength',
    label: '平均句长',
    fingerprintValue: `${fingerprint.avgSentenceLength} 字`,
    contentValue: `${contentMetrics.avgSentenceLength} 字`,
    deviation: slDev,
    status: statusFromDev(slDev),
    note:
      slDev < 0.25
        ? '句长接近范本'
        : `正文${contentMetrics.avgSentenceLength > fingerprint.avgSentenceLength ? '偏长' : '偏短'}，与范本${fingerprint.avgSentenceLength}字差距较大`,
  })

  // —— 对话占比 ——
  const dlDev = absDev(contentMetrics.dialogueRatio, fingerprint.dialogueRatio, 0.3)
  dims.push({
    key: 'dialogueRatio',
    label: '对话占比',
    fingerprintValue: `${(fingerprint.dialogueRatio * 100).toFixed(0)}%`,
    contentValue: `${(contentMetrics.dialogueRatio * 100).toFixed(0)}%`,
    deviation: dlDev,
    status: statusFromDev(dlDev),
    note:
      dlDev < 0.25
        ? '对话/叙述比例接近范本'
        : `正文对话占比${contentMetrics.dialogueRatio > fingerprint.dialogueRatio ? '偏高' : '偏低'}`,
  })

  // —— 标点习惯（逗号为主，加权破折号/省略号）——
  const punctDev = Math.max(
    relDev(contentMetrics.commaFreq, fingerprint.commaFreq),
    relDev(contentMetrics.dashFreq, fingerprint.dashFreq),
    relDev(contentMetrics.ellipsisFreq, fingerprint.ellipsisFreq),
  )
  dims.push({
    key: 'punctuation',
    label: '标点习惯',
    fingerprintValue: `逗号${fingerprint.commaFreq}/千字`,
    contentValue: `逗号${contentMetrics.commaFreq}/千字`,
    deviation: punctDev,
    status: statusFromDev(punctDev),
    note: punctDev < 0.25 ? '标点习惯接近范本' : '逗号/破折号/省略号使用频次与范本差异较大',
  })

  // —— 短句占比 ——
  const srDev = absDev(contentMetrics.shortSentenceRatio, fingerprint.shortSentenceRatio, 0.4)
  dims.push({
    key: 'shortRatio',
    label: '短句占比',
    fingerprintValue: `${(fingerprint.shortSentenceRatio * 100).toFixed(0)}%`,
    contentValue: `${(contentMetrics.shortSentenceRatio * 100).toFixed(0)}%`,
    deviation: srDev,
    status: statusFromDev(srDev),
    note: srDev < 0.25 ? '短句比例接近范本' : '句式节奏（短句比例）与范本差异较大',
  })

  // —— 用词丰富度 TTR ——
  const ttrDev = relDev(contentMetrics.typeTokenRatio, fingerprint.typeTokenRatio)
  dims.push({
    key: 'ttr',
    label: '用词丰富度',
    fingerprintValue: fingerprint.typeTokenRatio.toFixed(3),
    contentValue: contentMetrics.typeTokenRatio.toFixed(3),
    deviation: ttrDev,
    status: statusFromDev(ttrDev),
    note: ttrDev < 0.25 ? '用词丰富度接近范本' : '用词丰富度与范本差异较大',
  })

  // —— 加权总分 ——
  const weightMap: Record<string, number> = WEIGHTS
  let weighted = 0
  for (const d of dims) {
    const w = weightMap[d.key] ?? 0
    weighted += (1 - d.deviation) * w
  }
  const score = Math.round(weighted)
  const level: AuditResult['level'] = score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red'

  const badDims = dims.filter((d) => d.status === 'bad')
  const summary = badDims.length > 0
    ? `文风吻合度 ${score} 分，主要偏离：${badDims.map((d) => d.label).join('、')}`
    : `文风吻合度 ${score} 分，与范本文风较为一致`

  return { score, level, dimensions: dims, summary }
}
