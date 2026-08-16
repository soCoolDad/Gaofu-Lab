/**
 * 通用确认卡工具
 *
 * 用途：让模型在需要"任何类型的数据落库"时调此工具，生成一张"结果确认"卡片给用户预览。
 * 复用现有 PendingWrite / apply-hooks 机制——type 字段透传给 applyPendingWrite，
 * 卡片确认后走与现有写工具完全相同的落库路径。
 *
 * 三个动作（前端 store 实现）：
 * - 确认：调用 applyPendingWrite，按 type 落库
 * - 重跑：以 user 身份发"请按以下原因重新调用 request_user_confirmation：${reason}"，模型重新调本工具
 * - 拒绝：以 user 身份发"用户已拒绝 ${title}，请停止整条链路"，模型停止
 */

import { defineWriteTool } from './index'
import { createPendingWrite } from '../tool-executor'
import type { PendingWriteType } from '../types'

const SETTING_TYPE_VALUES = ['characters', 'locations', 'items', 'skills', 'scenes', 'factions', 'systems', 'inspirations', 'foreshadowings'] as const

const requestUserConfirmationTool = defineWriteTool(
  'request_user_confirmation',
  '通用确认卡工具。当任何操作牵扯到数据落库（写库）时，必须先调用本工具生成一张"结果确认"卡片给用户预览，用户可选择：确认（落库）/ 重跑（带原因重新生成本工具调用）/ 拒绝（带原因停止整条链路）。',
  'system',
  {
    type: {
      type: 'string',
      enum: [
        'book_info',
        'book_outline',
        'volume_list',
        'volume_outline',
        'volume_info',
        'chapter_list',
        'chapter_outline',
        'chapter_info',
        'chapter_content',
        'book_setting',
        'setting_info',
        'delete_entity',
        'chapter_snapshot',
      ] as PendingWriteType[],
      description: '要执行的操作类型。必须与现有写工具的 PendingWriteType 保持一致，确认后由 apply-hooks 按此类型落库。',
    },
    title: {
      type: 'string',
      description: '卡片标题，给用户看。',
    },
    summary: {
      type: 'string',
      description: '卡片说明，简要描述本次操作的内容与目的。',
    },
    target: {
      type: 'object',
      description: '作用目标。字段与现有 PendingWrite.target 保持一致：{bookId?, volumeId?, chapterId?, settingId?, settingType?, entityType?, entityIds?}。',
    },
    applyMode: {
      type: 'string',
      enum: ['insert', 'update', 'append', 'replace', 'merge', 'none'],
      description: '应用模式，与现有 PendingWrite.applyMode 保持一致。',
    },
    data: {
      type: 'object',
      description: '要写入的数据。结构与现有 PendingWrite.data 保持一致：{content?, items?, ...}。',
    },
    preview: {
      type: 'object',
      description: '可选：给用户看的预览内容。结构与现有 PendingWrite.preview 保持一致：{title?, summary?, content?, items?}。',
    },
    riskLevel: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: '风险等级。删除/覆写类操作建议设为 high，纯新增类可设为 low。',
    },
  },
  ['type', 'title', 'target', 'data'],
  async (args, ctx) => {
    // ── 0. 按 type 校验必需字段（缺失就返回 error，让模型重传；不写入 NULL）────
    const data = (args.data || {}) as Record<string, any>
    const validations: Array<{ ok: boolean; msg: string }> = []
    if (args.type === 'book_setting') {
      validations.push({
        ok: typeof data.type === 'string' && SETTING_TYPE_VALUES.includes(data.type as any),
        msg: `data.type 必须是以下之一: ${SETTING_TYPE_VALUES.join('/')}`,
      })
      validations.push({
        ok: Array.isArray(data.items) && data.items.length > 0,
        msg: 'data.items 必须是非空数组',
      })
    } else if (args.type === 'book_outline') {
      validations.push({
        ok: typeof data.content === 'string' && data.content.length > 0,
        msg: 'data.content 必须是非空字符串',
      })
    } else if (args.type === 'volume_list' || args.type === 'chapter_list') {
      validations.push({
        ok: Array.isArray(data.items) && data.items.length > 0,
        msg: 'data.items 必须是非空数组',
      })
    } else if (args.type === 'volume_outline') {
      validations.push({
        ok: typeof data.outline === 'string' && data.outline.length > 0,
        msg: 'data.outline 必须是非空字符串',
      })
    } else if (args.type === 'chapter_outline') {
      validations.push({
        ok: typeof data.outline === 'string' && data.outline.length > 0,
        msg: 'data.outline 必须是非空字符串',
      })
    } else if (args.type === 'chapter_content') {
      validations.push({
        ok: typeof data.content === 'string' && data.content.length > 0,
        msg: 'data.content 必须是非空字符串',
      })
    } else if (args.type === 'chapter_snapshot') {
      validations.push({
        ok: typeof data.chapterId === 'string' && data.chapterId.length > 0,
        msg: 'data.chapterId 必填',
      })
    } else if (args.type === 'delete_entity') {
      // target.entityType / target.entityIds 的校验在下面统一做（需要 userTarget）
    }
    for (const v of validations) {
      if (!v.ok) return { error: `[request_user_confirmation] ${v.msg}（type=${args.type}）` }
    }

    // ── 1. target 兜底注入上下文 id ─────────────────────────────────────────
    const userTarget = (args.target || {}) as Record<string, any>
    const target: Record<string, any> = { ...userTarget }
    if (!target.bookId && ctx.bookId) target.bookId = ctx.bookId
    if (!target.volumeId && ctx.volumeId) target.volumeId = ctx.volumeId
    if (!target.chapterId && ctx.chapterId) target.chapterId = ctx.chapterId

    // ── 2. delete_entity 校验 target ─────────────────────────────────────────
    if (args.type === 'delete_entity') {
      if (!target.entityType) return { error: '[request_user_confirmation] target.entityType 必填（chapter/volume/book/setting）' }
      if (!Array.isArray(target.entityIds) || target.entityIds.length === 0) {
        return { error: '[request_user_confirmation] target.entityIds 必填，且是非空数组' }
      }
    }

    return {
      pendingWrite: createPendingWrite({
        type: args.type as PendingWriteType,
        title: args.title,
        summary: args.summary || '',
        target,
        applyMode: args.applyMode || 'update',
        data,
        preview: args.preview,
        riskLevel: args.riskLevel || 'medium',
      }),
    }
  },
)

export const confirmationTools = [requestUserConfirmationTool]
