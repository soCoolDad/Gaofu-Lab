import { create } from 'zustand'
import type {
  AuthorFactUpdate,
  CreateRoleDialogueRoomInput,
  CreateRoleDialogueSnippetInput,
  RoleDialogueCharacterModel,
  RoleDialogueRoom,
  RoleDialogueRun,
  RoleDialogueSnippet,
  SnippetMessage,
  UpdateRoleDialogueRoomInput,
} from '@/types/api'

/**
 * 流式渲染节流 helper：
 * 把同一帧内的多次 update 合并成一次 setState。
 * 每个流式 chunk（delta / reasoning）都会触发 onXxx 回调——如果不节流，React 会在每个 token 都重渲染组件树。
 * 关键：仍然把"流式累积"放在闭包变量里（不丢字符），只在 flush 时一次 setState。
 */
function createStreamingBatcher<T>(apply: (merged: T) => void) {
  let pending: T | null = null
  let scheduled = false
  const flush = () => {
    scheduled = false
    if (pending === null) return
    const m = pending
    pending = null
    apply(m)
  }
  return (next: T) => {
    pending = next
    if (scheduled) return
    scheduled = true
    // 用 rAF 合并（同帧多次 → 单次渲染）—— 等价 60fps 批量更新
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(flush)
    } else {
      setTimeout(flush, 16)
    }
  }
}

/** 「知卷」model 选择的 localStorage key（与 pages/Agent/index.tsx 保持一致） */
export const AGENT_MODEL_LS_KEY = 'agent:selectedModelId'

function readAgentFallbackModelId(): string | null {
  try {
    const v = localStorage.getItem(AGENT_MODEL_LS_KEY)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

type RoleDialogueState = {
  // ─── 数据 ───
  rooms: RoleDialogueRoom[]
  runsByRoom: Record<string, RoleDialogueRun[]>
  snippetsByRun: Record<string, RoleDialogueSnippet[]>
  // 当前选中
  currentRoomId: string | null
  currentRunId: string | null
  // ─── 状态 ───
  loading: boolean
  generating: boolean
  /** 哪个 run 正在生成（用于 UI 局部 loading） */
  generatingRunId: string | null
  /** 正在流式累积的临时片段（"逐角色 + 逐 token"实时显示用） */
  streamingSnippet: {
    runId: string
    order: number
    /** 已完成 + 正在流式（最后一条 publicContent 是 partial） */
    messages: Array<SnippetMessage & { __partial?: boolean }>
    authorFactUpdate: { fact: string; insertedAt: string } | null
  } | null
  /** 正在流式生成的总结片段（"总结片段"按钮触发） */
  streamingSummary: {
    runId: string
    summaryId: string
    view: 'first-person' | 'third-person'
    viewCharacterId: string | null
    content: string
    reasoning: string
  } | null

  // ─── Actions: 房间 ───
  loadRooms: (bookId: string) => Promise<void>
  createRoom: (data: CreateRoleDialogueRoomInput) => Promise<RoleDialogueRoom>
  updateRoom: (id: string, data: UpdateRoleDialogueRoomInput) => Promise<RoleDialogueRoom>
  deleteRoom: (id: string) => Promise<void>
  setCurrentRoom: (id: string | null) => void

  // ─── Actions: Run ───
  loadRuns: (roomId: string) => Promise<void>
  createRun: (roomId: string, characterIds: string[]) => Promise<RoleDialogueRun>
  deleteRun: (id: string) => Promise<void>
  updateRunCharacters: (runId: string, characterIds: string[]) => Promise<void>
  setCurrentRun: (id: string | null) => void

  // ─── Actions: 片段 ───
  loadSnippets: (runId: string) => Promise<void>
  generateAndCreateSnippet: (runId: string, characterIds: string[], authorFact?: string | null) => Promise<RoleDialogueSnippet | null>
  regenerateSnippet: (id: string, characterIds: string[]) => Promise<void>
  insertAuthorFact: (id: string, fact: string) => Promise<void>
  appendNarrator: (runId: string, text: string) => Promise<RoleDialogueSnippet | null>
  deleteSnippet: (id: string) => Promise<void>
  generateSummary: (runId: string, view: 'first-person' | 'third-person', viewCharacterId?: string | null, sourceSummaryId?: string | null) => Promise<RoleDialogueSnippet | null>

  // ─── Actions: 角色 model ───
  setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => Promise<void>
  getCharacterModel: (bookId: string, characterId: string) => Promise<RoleDialogueCharacterModel | null>

  // ─── Actions: UI ───
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  /** 数据管理全局清空后，重置前端所有剧情预演状态 */
  resetAll: () => void
}

export const useRoleDialogueStore = create<RoleDialogueState>((set, get) => ({
  rooms: [],
  runsByRoom: {},
  snippetsByRun: {},
  currentRoomId: null,
  currentRunId: null,
  loading: false,
  generating: false,
  generatingRunId: null,
  streamingSnippet: null,
  streamingSummary: null,
  sidebarCollapsed: false,

  // ─── 房间 ───
  loadRooms: async (bookId) => {
    set({ loading: true })
    try {
      const rooms = await window.api.roleDialogue.listRooms(bookId)
      set({ rooms })
    } finally {
      set({ loading: false })
    }
  },

  createRoom: async (data) => {
    const room = await window.api.roleDialogue.createRoom(data)
    set((s) => ({ rooms: [room, ...s.rooms] }))
    return room
  },

  updateRoom: async (id, data) => {
    const room = await window.api.roleDialogue.updateRoom(id, data)
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? room : r)) }))
    return room
  },

  deleteRoom: async (id) => {
    await window.api.roleDialogue.deleteRoom(id)
    set((s) => {
      const { [id]: _, ...restRuns } = s.runsByRoom
      return {
        rooms: s.rooms.filter((r) => r.id !== id),
        runsByRoom: restRuns,
        currentRoomId: s.currentRoomId === id ? null : s.currentRoomId,
        currentRunId: s.currentRoomId === id ? null : s.currentRunId,
      }
    })
  },

  setCurrentRoom: (id) => set({ currentRoomId: id, currentRunId: null }),

  // ─── Run ───
  loadRuns: async (roomId) => {
    const runs = await window.api.roleDialogue.listRuns(roomId)
    set((s) => ({ runsByRoom: { ...s.runsByRoom, [roomId]: runs } }))
  },

  createRun: async (roomId, characterIds) => {
    const run = await window.api.roleDialogue.createRun({ roomId, characterIds })
    set((s) => ({
      runsByRoom: {
        ...s.runsByRoom,
        [roomId]: [...(s.runsByRoom[roomId] || []), run],
      },
      currentRunId: run.id,
    }))
    return run
  },

  deleteRun: async (id) => {
    const roomId = get().currentRoomId
    await window.api.roleDialogue.deleteRun(id)
    if (roomId) {
      set((s) => ({
        runsByRoom: {
          ...s.runsByRoom,
          [roomId]: (s.runsByRoom[roomId] || []).filter((r) => r.id !== id),
        },
        currentRunId: s.currentRunId === id ? null : s.currentRunId,
      }))
    }
  },

  updateRunCharacters: async (runId, characterIds) => {
    const updated = await window.api.roleDialogue.updateRunCharacters(runId, characterIds)
    const roomId = get().currentRoomId
    if (updated && roomId) {
      set((s) => ({
        runsByRoom: {
          ...s.runsByRoom,
          [roomId]: (s.runsByRoom[roomId] || []).map((r) => (r.id === runId ? updated : r)),
        },
      }))
    }
  },

  setCurrentRun: (id) => set({ currentRunId: id }),

  // ─── 片段 ───
  loadSnippets: async (runId) => {
    const snippets = await window.api.roleDialogue.listSnippets(runId)
    set((s) => ({ snippetsByRun: { ...s.snippetsByRun, [runId]: snippets } }))
  },

  generateAndCreateSnippet: async (runId, characterIds, authorFact) => {
    if (get().generating) return null
    // 计算 order（先算好，streaming 时直接显示）
    const existing = get().snippetsByRun[runId] || []
    const order = existing.length > 0 ? Math.max(...existing.map((s) => s.order)) + 1 : 1
    const authorFactUpdate = authorFact
      ? { fact: authorFact, insertedAt: new Date().toISOString() }
      : null

    // 初始化 streamingSnippet（UI 立即看到"正在生成 N 位角色..."）
    set({
      generating: true,
      generatingRunId: runId,
      streamingSnippet: {
        runId,
        order,
        messages: [],
        authorFactUpdate,
      },
    })

    // ───── 性能优化：多角色并行的流式累积走 rAF batcher ─────
    // 关键思路：
    //   1. 每个角色维护一个 accumulator（闭包 Map，不进 setState）—— 避免 setState 时大量字符串拼接
    //   2. 三个通道（chunk / delta / reasoning）都 push 到 accumulator，再由统一 batcher 定期 flush 到 zustand
    //   3. accumulator 含"最终 chunk"标记：若 chunk 到达后 delta 不再追加，flush 时按"final > partial"优先
    //   4. flush 时按 characterIds 顺序输出 messages，保证 UI 顺序稳定
    type Accum = {
      characterId: string
      characterName: string
      publicContent: string
      reasoning: string
      isFinal: boolean  // chunk 已到达，不再有 delta
    }
    const accumulators = new Map<string, Accum>()
    // 角色名缓存（delta 创建占位时也要用 name，但后端 payload 也有 name → 缓存首条）
    const nameByChar = new Map<string, string>()

    const flushBatched = createStreamingBatcher<{}>(() => {
      set((s) => {
        if (!s.streamingSnippet || s.streamingSnippet.runId !== runId) return s
        // 按 characterIds 顺序输出 messages（与作者指定顺序一致），未指定顺序的追加到末尾
        const seen = new Set<string>()
        const ordered: Array<{ characterId: string; characterName: string; publicContent: string; innerThought: string; reasoning: string; modelId: string; __partial: boolean }> = []
        for (const cid of characterIds) {
          const a = accumulators.get(cid)
          if (!a) continue
          seen.add(cid)
          ordered.push({
            characterId: a.characterId,
            characterName: a.characterName,
            publicContent: a.publicContent,
            innerThought: '',
            reasoning: a.reasoning,
            modelId: '',
            __partial: !a.isFinal,
          })
        }
        // 兜底：非 characterIds 列表里的角色（如 narrator）追加
        for (const [cid, a] of accumulators) {
          if (seen.has(cid)) continue
          ordered.push({
            characterId: a.characterId,
            characterName: a.characterName,
            publicContent: a.publicContent,
            innerThought: '',
            reasoning: a.reasoning,
            modelId: '',
            __partial: !a.isFinal,
          })
        }
        return { streamingSnippet: { ...s.streamingSnippet, messages: ordered } }
      })
    })

    const getOrCreate = (characterId: string, characterName?: string) => {
      let a = accumulators.get(characterId)
      if (!a) {
        a = {
          characterId,
          characterName: characterName || nameByChar.get(characterId) || characterId,
          publicContent: '',
          reasoning: '',
          isFinal: false,
        }
        accumulators.set(characterId, a)
      }
      if (characterName) {
        a.characterName = characterName
        nameByChar.set(characterId, characterName)
      }
      return a
    }

    // 订阅流式事件（每个角色完整生成后触发一次）
    // 注意：chunk 是后端给出的"最终解析结果"，标记 isFinal=true，不再受 delta 影响
    const offChunk = window.api.roleDialogue.onSnippetChunk((payload) => {
      if (payload.runId !== runId) return
      const a = getOrCreate(payload.message.characterId, payload.message.characterName)
      a.publicContent = payload.message.publicContent || ''
      a.reasoning = payload.message.reasoning || a.reasoning
      a.isFinal = true
      flushBatched({})
      // 单个角色模型调用完毕即通知主菜单刷新今日 Token（后端此时已 writeTokenLog 落库）
      window.dispatchEvent(new Event('token-usage-updated'))
    })

    // 订阅逐 token delta：把 delta 累加到对应角色
    const offDelta = window.api.roleDialogue.onSnippetDelta((payload) => {
      if (payload.runId !== runId) return
      if (!payload.delta && !payload.reasoningDelta) return
      const a = getOrCreate(payload.characterId, payload.characterName)
      if (payload.delta) a.publicContent = (a.publicContent || '') + payload.delta
      if (payload.reasoningDelta) a.reasoning = (a.reasoning || '') + payload.reasoningDelta
      flushBatched({})
    })

    // 订阅 reasoning 单独通道（与 delta 通道合并到同一 accumulator）
    const offReasoning = window.api.roleDialogue.onSnippetReasoning?.((payload) => {
      if (payload.runId !== runId) return
      if (!payload.delta) return
      const a = getOrCreate(payload.characterId, payload.characterName)
      a.reasoning = (a.reasoning || '') + payload.delta
      flushBatched({})
    })

    try {
      // await 旧 IPC（向后兼容：仍会返回完整 messages，createSnippet 也照常做）
      const messages = await window.api.roleDialogue.generateSnippet({
        runId,
        characterIds,
        authorFact: authorFact ?? null,
        agentFallbackModelId: readAgentFallbackModelId(),
      })
      // 持久化（用后端返回的最终 messages，覆盖 streaming）
      const data: CreateRoleDialogueSnippetInput = {
        runId,
        order,
        characterIds,
        messages,
        authorFactUpdate,
      }
      const snippet = await window.api.roleDialogue.createSnippet(data)
      set((s) => ({
        snippetsByRun: { ...s.snippetsByRun, [runId]: [...(s.snippetsByRun[runId] || []), snippet] },
      }))
      return snippet
    } finally {
      offChunk()
      offDelta()
      offReasoning?.()
      set({ generating: false, generatingRunId: null, streamingSnippet: null })
      // 通知主菜单（AppSidebar）刷新今日 Token 汇总
      window.dispatchEvent(new Event('token-usage-updated'))
    }
  },

  regenerateSnippet: async (id, characterIds) => {
    const runId = get().currentRunId
    if (!runId) return
    if (get().generating) return
    set({ generating: true, generatingRunId: runId })
    try {
      // 找当前片段的 authorFactUpdate（用于下次生成的 context）
      const existing = (get().snippetsByRun[runId] || []).find((s) => s.id === id)
      const authorFact = existing?.authorFactUpdate?.fact ?? null
      const messages = await window.api.roleDialogue.generateSnippet({
        runId,
        characterIds,
        authorFact,
        agentFallbackModelId: readAgentFallbackModelId(),
      })
      await window.api.roleDialogue.regenerateSnippet(id, messages)
      // 重新加载
      const snippets = await window.api.roleDialogue.listSnippets(runId)
      set((s) => ({ snippetsByRun: { ...s.snippetsByRun, [runId]: snippets } }))
    } finally {
      set({ generating: false, generatingRunId: null })
      window.dispatchEvent(new Event('token-usage-updated'))
    }
  },

  insertAuthorFact: async (id, fact) => {
    const runId = get().currentRunId
    if (!runId) return
    await window.api.roleDialogue.insertAuthorFact(id, fact)
    const snippets = await window.api.roleDialogue.listSnippets(runId)
    set((s) => ({ snippetsByRun: { ...s.snippetsByRun, [runId]: snippets } }))
  },

  appendNarrator: async (runId, text) => {
    if (!runId || !text.trim()) return null
    const created = await window.api.roleDialogue.appendNarratorSnippet(runId, text.trim())
    if (created) {
      set((s) => ({
        snippetsByRun: {
          ...s.snippetsByRun,
          [runId]: [...(s.snippetsByRun[runId] || []), created],
        },
      }))
    }
    return created ?? null
  },

  deleteSnippet: async (id) => {
    const runId = get().currentRunId
    if (!runId) return
    await window.api.roleDialogue.deleteSnippet(id)
    const snippets = await window.api.roleDialogue.listSnippets(runId)
    set((s) => ({ snippetsByRun: { ...s.snippetsByRun, [runId]: snippets } }))
  },

  generateSummary: async (runId, view, viewCharacterId, sourceSummaryId) => {
    if (!runId) return null
    if (get().generating || get().streamingSummary) return null
    // 关键：使用前端 localId 与后端在 generateSummary 第一次 emit 时填入的 summaryId 配对。
    // 之前用 streaming_summary_<ts> 前缀，但后端 emit 时是 uuidv4，summaryId 永远不匹配
    // 导致所有 delta / reasoning 都被过滤掉，流式渲染完全是空的。
    // 修复：runId 已足够区分（同一 Run 同一时刻只会有一个 streaming summary）
    const summaryId = `streaming_summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    set({
      generating: true,
      generatingRunId: runId,
      streamingSummary: { runId, summaryId, view, viewCharacterId: viewCharacterId ?? null, content: '', reasoning: '' },
    })

    // 闭包变量持有"未 flush 的增量"，避免每个 token 都触发 setState
    let pendingContent = ''
    let pendingReasoning = ''
    const flushBatched = createStreamingBatcher<{ content: string; reasoning: string }>((merged) => {
      set((s) => {
        if (!s.streamingSummary || s.streamingSummary.runId !== runId) return s
        return { streamingSummary: { ...s.streamingSummary, content: merged.content, reasoning: merged.reasoning } }
      })
    })

    const offDelta = window.api.roleDialogue.onSummaryDelta((payload) => {
      // 只匹配 runId：后端会发自己的 uuidv4 summaryId，前端拿不到
      if (payload.runId !== runId) return
      if (!payload.delta) return
      pendingContent += payload.delta
      flushBatched({ content: pendingContent, reasoning: pendingReasoning })
    })
    const offReasoning = window.api.roleDialogue.onSummaryReasoning((payload) => {
      if (payload.runId !== runId) return
      if (!payload.delta) return
      pendingReasoning += payload.delta
      flushBatched({ content: pendingContent, reasoning: pendingReasoning })
    })
    const offDone = window.api.roleDialogue.onSummaryDone(async (payload) => {
      if (payload.runId !== runId) return
      // 收到 done 后重新拉一次列表（确保落库后数据完整）
      try {
        const snippets = await window.api.roleDialogue.listSnippets(runId)
        set((s) => ({ snippetsByRun: { ...s.snippetsByRun, [runId]: snippets } }))
      } catch {}
    })

    try {
      const snippet = await window.api.roleDialogue.generateSummary({
        runId,
        view,
        viewCharacterId: viewCharacterId ?? null,
        agentFallbackModelId: readAgentFallbackModelId(),
        sourceSummaryId: sourceSummaryId ?? null,
      })
      // 关键：拿到后端返回的 snippet（已落库）后**主动 push 到 store**，
      // 而不是只依赖 onSummaryDone 监听器内异步重拉——
      // 之前监听器内的 listSnippets 是异步的，可能与 finally 的 setState 竞态，
      // 导致 summary 卡片在 currentSnippets 里短暂缺失。
      if (snippet) {
        set((s) => {
          const existing = s.snippetsByRun[runId] || []
          const idx = existing.findIndex((x) => x.id === snippet.id)
          if (idx >= 0) {
            // 重新总结：原地替换（保证 UI 立即显示新内容）
            const next = [...existing]
            next[idx] = snippet
            return { snippetsByRun: { ...s.snippetsByRun, [runId]: next } }
          }
          // 新建总结：追加
          return { snippetsByRun: { ...s.snippetsByRun, [runId]: [...existing, snippet] } }
        })
      }
      return snippet
    } finally {
      offDelta()
      offReasoning()
      offDone()
      set({ generating: false, generatingRunId: null, streamingSummary: null })
      window.dispatchEvent(new Event('token-usage-updated'))
    }
  },

  // ─── 角色 model ───
  setCharacterModel: async (bookId, characterId, modelId) => {
    await window.api.roleDialogue.setCharacterModel(bookId, characterId, modelId)
  },

  getCharacterModel: async (bookId, characterId) => {
    return await window.api.roleDialogue.getCharacterModel(bookId, characterId)
  },

  // ─── UI ───
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  resetAll: () =>
    set({
      rooms: [],
      runsByRoom: {},
      snippetsByRun: {},
      currentRoomId: null,
      currentRunId: null,
      loading: false,
      generating: false,
      generatingRunId: null,
      streamingSnippet: null,
      streamingSummary: null,
    }),
}))
