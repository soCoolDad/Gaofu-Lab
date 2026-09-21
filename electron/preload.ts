import { contextBridge, ipcRenderer, clipboard } from 'electron'

const api = {
  clipboard: {
    writeText: (text: string) => clipboard.writeText(text),
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    versions: () => ipcRenderer.invoke('app:versions') as Promise<{ electron: string; chrome: string; node: string }>,
    devtools: () => ipcRenderer.invoke('app:devtools'),
    exportDb: () => ipcRenderer.invoke('db:export') as Promise<{ success: boolean; path?: string; reason?: string }>,
    importDb: () => ipcRenderer.invoke('db:import') as Promise<{ success: boolean; reason?: string }>,
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
  },

  // 书籍
  book: {
    list: () => ipcRenderer.invoke('book:list'),
    get: (id: string) => ipcRenderer.invoke('book:get', id),
    create: (data: { id?: string; title: string; description?: string }) =>
      ipcRenderer.invoke('book:create', data),
    update: (id: string, data: Partial<{ title: string; description: string; cover: string }>) =>
      ipcRenderer.invoke('book:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('book:delete', id),
  },

  // 章节
  chapter: {
    list: (bookId: string) => ipcRenderer.invoke('chapter:list', bookId),
    listPaged: (data: { bookId: string; page: number; pageSize: number; volumeId?: string | null }) => ipcRenderer.invoke('chapter:listPaged', data),
    get: (id: string) => ipcRenderer.invoke('chapter:get', id),
    stats: (bookId: string) => ipcRenderer.invoke('chapter:stats', bookId),
    create: (data: {
      bookId: string
      volumeId?: string
      title: string
      summary?: string
      outline?: string
      sortOrder?: number
    }) => ipcRenderer.invoke('chapter:create', data),
    bulkCreate: (data: {
      bookId: string
      mode?: 'append' | 'replace'
      chapters: Array<{
        title: string
        summary?: string
        outline?: string
        volumeId?: string | null
        volumeTitle?: string | null
      }>
    }) => ipcRenderer.invoke('chapter:bulkCreate', data),
    update: (id: string, data: {
      title?: string
      summary?: string
      outline?: string
      content?: string
      status?: string
      volumeId?: string
      sortOrder?: number
    }) => ipcRenderer.invoke('chapter:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('chapter:delete', id),
  },

  // 分卷
  volume: {
    list: (bookId: string) => ipcRenderer.invoke('volume:list', bookId),
    create: (data: { bookId: string; title: string; description?: string; outline?: string; sortOrder?: number }) =>
      ipcRenderer.invoke('volume:create', data),
    bulkCreate: (data: {
      bookId: string
      mode?: 'append' | 'replace'
      volumes: Array<{ title: string; description?: string; outline?: string }>
    }) => ipcRenderer.invoke('volume:bulkCreate', data),
    update: (id: string, data: Partial<{ title: string; description: string; outline: string; sortOrder: number }>) =>
      ipcRenderer.invoke('volume:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('volume:delete', id),
  },

  outline: {
    getBook: (bookId: string) => ipcRenderer.invoke('outline:getBook', bookId),
    saveBook: (bookId: string, content: string) => ipcRenderer.invoke('outline:saveBook', bookId, content),
  },

  bookSetting: {
    list: (data: { bookId: string; type: string }) => ipcRenderer.invoke('bookSetting:list', data),
    listAll: (bookId: string) => ipcRenderer.invoke('bookSetting:listAll', bookId),
    create: (data: { bookId: string; type: string; name: string; description?: string; detail?: string }) => ipcRenderer.invoke('bookSetting:create', data),
    update: (id: string, data: Partial<{ name: string; description: string; detail: string }>) => ipcRenderer.invoke('bookSetting:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('bookSetting:delete', id),
  },

  // 模型
  model: {
    list: () => ipcRenderer.invoke('model:list'),
    get: (id: string) => ipcRenderer.invoke('model:get', id),
    create: (data: {
      name: string
      provider: string
      apiKey: string
      modelName: string
      baseUrl?: string
      inputPrice?: number
      outputPrice?: number
      cachedInputPrice?: number
      maxOutputTokens?: number
      maxContextTokens?: number
      temperature?: number | null
      topP?: number | null
      frequencyPenalty?: number | null
      presencePenalty?: number | null
      billingRules?: string | null
      mergeSystemMessages?: boolean
    }) => ipcRenderer.invoke('model:create', data),
    update: (id: string, data: Partial<{
      name: string
      provider: string
      apiKey: string
      modelName: string
      baseUrl?: string
      inputPrice?: number
      outputPrice?: number
      cachedInputPrice?: number
      enabled: boolean
      maxOutputTokens?: number
      maxContextTokens?: number
      temperature?: number | null
      topP?: number | null
      frequencyPenalty?: number | null
      presencePenalty?: number | null
      billingRules?: string | null
      mergeSystemMessages?: boolean
    }>) => ipcRenderer.invoke('model:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('model:delete', id),
    fetchModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('model:fetchModels', baseUrl, apiKey),
  },

  settings: {
    clearBooks: () => ipcRenderer.invoke('settings:clearBooks'),
    clearModels: () => ipcRenderer.invoke('settings:clearModels'),
    clearTokens: () => ipcRenderer.invoke('settings:clearTokens'),
    clearApplyLogs: () => ipcRenderer.invoke('settings:clearApplyLogs'),
    clearChatMessages: () => ipcRenderer.invoke('settings:clearChatMessages'),
    clearRoleDialogue: () => ipcRenderer.invoke('settings:clearRoleDialogue'),
    clearChatRoom: () => ipcRenderer.invoke('settings:clearChatRoom'),
    clearPromptCaches: () => ipcRenderer.invoke('settings:clearPromptCaches'),
    clearAll: () => ipcRenderer.invoke('settings:clearAll'),
    getAiSettings: () => ipcRenderer.invoke('settings:getAiSettings') as Promise<any | null>,
    saveAiSettings: (data: any) => ipcRenderer.invoke('settings:saveAiSettings', data),
    // 「任务默认模型参数」的任务注册表（后端单一数据源：electron/utils/sampling.ts）
    getSamplingTasks: () => ipcRenderer.invoke('settings:getSamplingTasks'),
  },

  // AI 聊天消息持久化
  chatMessage: {
    list: (bookId: string) => ipcRenderer.invoke('chatMessage:list', bookId),
    saveBatch: (data: { bookId: string; messages: any[] }) => ipcRenderer.invoke('chatMessage:saveBatch', data),
    clear: (bookId: string) => ipcRenderer.invoke('chatMessage:clear', bookId),
    move: (data: { fromBookId: string; toBookId: string }) => ipcRenderer.invoke('chatMessage:move', data),
    moveByIds: (data: { messageIds: string[]; toBookId: string }) => ipcRenderer.invoke('chatMessage:moveByIds', data),
    copyByIds: (data: { messageIds: string[]; toBookId: string }) => ipcRenderer.invoke('chatMessage:copyByIds', data),
    clearAll: () => ipcRenderer.invoke('chatMessage:clearAll'),
    deleteByBook: (bookId: string) => ipcRenderer.invoke('chatMessage:deleteByBook', bookId),
  },

  // 剧情预演（Role Dialogue）
  roleDialogue: {
    // 房间
    listRooms: (bookId: string) => ipcRenderer.invoke('roleDialogue:listRooms', bookId),
    createRoom: (data: any) => ipcRenderer.invoke('roleDialogue:createRoom', data),
    updateRoom: (id: string, data: any) => ipcRenderer.invoke('roleDialogue:updateRoom', id, data),
    deleteRoom: (id: string) => ipcRenderer.invoke('roleDialogue:deleteRoom', id),
    // Run
    listRuns: (roomId: string) => ipcRenderer.invoke('roleDialogue:listRuns', roomId),
    createRun: (data: any) => ipcRenderer.invoke('roleDialogue:createRun', data),
    deleteRun: (id: string) => ipcRenderer.invoke('roleDialogue:deleteRun', id),
    updateRunCharacters: (runId: string, characterIds: string[]) => ipcRenderer.invoke('roleDialogue:updateRunCharacters', runId, characterIds),
    // 片段
    listSnippets: (runId: string) => ipcRenderer.invoke('roleDialogue:listSnippets', runId),
    createSnippet: (data: any) => ipcRenderer.invoke('roleDialogue:createSnippet', data),
    updateSnippet: (id: string, data: any) => ipcRenderer.invoke('roleDialogue:updateSnippet', id, data),
    regenerateSnippet: (id: string, newMessages: any[]) => ipcRenderer.invoke('roleDialogue:regenerateSnippet', id, newMessages),
    insertAuthorFact: (id: string, fact: string) => ipcRenderer.invoke('roleDialogue:insertAuthorFact', id, fact),
    appendNarratorSnippet: (runId: string, narratorText: string) => ipcRenderer.invoke('roleDialogue:appendNarratorSnippet', runId, narratorText),
    deleteSnippet: (id: string) => ipcRenderer.invoke('roleDialogue:deleteSnippet', id),
    // 角色 model 偏好
    getCharacterModel: (bookId: string, characterId: string) => ipcRenderer.invoke('roleDialogue:getCharacterModel', bookId, characterId),
    setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => ipcRenderer.invoke('roleDialogue:setCharacterModel', bookId, characterId, modelId),
    // 合并去重的角色列表（bookSetting + bookMemory）
    listCharacters: (bookId: string) => ipcRenderer.invoke('roleDialogue:listCharacters', bookId),
    // 生成片段
    generateSnippet: (data: { runId: string; characterIds: string[]; authorFact?: string | null; agentFallbackModelId?: string | null }) => ipcRenderer.invoke('roleDialogue:generateSnippet', data),
    // 总结片段
    generateSummary: (data: { runId: string; view: 'first-person' | 'third-person'; viewCharacterId?: string | null; agentFallbackModelId?: string | null; sourceSummaryId?: string | null }) => ipcRenderer.invoke('roleDialogue:generateSummary', data),
    onSummaryDelta: (listener: (payload: { runId: string; summaryId: string; delta: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:summaryDelta', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:summaryDelta', wrap)
    },
    onSummaryReasoning: (listener: (payload: { runId: string; summaryId: string; delta: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:summaryReasoning', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:summaryReasoning', wrap)
    },
    onSummaryDone: (listener: (payload: { runId: string; summaryId: string; snippet: any }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:summaryDone', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:summaryDone', wrap)
    },
    onSummaryError: (listener: (payload: { runId: string; message: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:summaryError', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:summaryError', wrap)
    },
    // 逐角色增量事件（流式显示用）
    onSnippetChunk: (listener: (payload: { runId: string; index: number; total: number; message: any }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:snippetChunk', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:snippetChunk', wrap)
    },
    onSnippetDelta: (listener: (payload: { runId: string; characterId: string; characterName: string; delta?: string; reasoningDelta?: string; partial?: string; index: number; total: number }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:snippetDelta', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:snippetDelta', wrap)
    },
    onSnippetReasoning: (listener: (payload: { runId: string; characterId: string; characterName: string; delta: string; index: number; total: number }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:snippetReasoning', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:snippetReasoning', wrap)
    },
    onSnippetDone: (listener: (payload: { runId: string; messages: any[] }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('roleDialogue:snippetDone', wrap)
      return () => ipcRenderer.removeListener('roleDialogue:snippetDone', wrap)
    },
  },

  // 角色聊天室（Chat Room）
  chatRoom: {
    // 房间
    listRooms: (bookId: string) => ipcRenderer.invoke('chatRoom:listRooms', bookId),
    createRoom: (data: any) => ipcRenderer.invoke('chatRoom:createRoom', data),
    updateRoom: (id: string, data: any) => ipcRenderer.invoke('chatRoom:updateRoom', id, data),
    deleteRoom: (id: string) => ipcRenderer.invoke('chatRoom:deleteRoom', id),
    // 在场角色
    listParticipants: (roomId: string) => ipcRenderer.invoke('chatRoom:listParticipants', roomId),
    addParticipant: (roomId: string, characterId: string) => ipcRenderer.invoke('chatRoom:addParticipant', roomId, characterId),
    removeParticipant: (id: string) => ipcRenderer.invoke('chatRoom:removeParticipant', id),
    reorderParticipants: (roomId: string, orderedIds: string[]) => ipcRenderer.invoke('chatRoom:reorderParticipants', roomId, orderedIds),
    // 消息
    listMessages: (roomId: string) => ipcRenderer.invoke('chatRoom:listMessages', roomId),
    clearMessages: (roomId: string) => ipcRenderer.invoke('chatRoom:clearMessages', roomId),
    deleteMessage: (id: string) => ipcRenderer.invoke('chatRoom:deleteMessage', id),
    // 选角色（本书）
    listCharacters: (bookId: string) => ipcRenderer.invoke('chatRoom:listCharacters', bookId),
    // 角色定稿记忆状态（右侧面板「最近的状态」）
    getCharacterMemoryStates: (bookId: string, characterIds: string[]) => ipcRenderer.invoke('chatRoom:getCharacterMemoryStates', bookId, characterIds),
    // 角色 model 偏好
    getCharacterModel: (bookId: string, characterId: string) => ipcRenderer.invoke('chatRoom:getCharacterModel', bookId, characterId),
    setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => ipcRenderer.invoke('chatRoom:setCharacterModel', bookId, characterId, modelId),
    // 生成回合
    sendTurn: (data: { roomId: string; userContent: string; agentFallbackModelId?: string | null }) => ipcRenderer.invoke('chatRoom:sendTurn', data),
    characterSpeak: (roomId: string, characterId: string) => ipcRenderer.invoke('chatRoom:characterSpeak', roomId, characterId),
    // 流式事件
    onMessageStart: (listener: (payload: { roomId: string; messageId: string; characterId: string; characterName: string; order: number }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:messageStart', wrap)
      return () => ipcRenderer.removeListener('chatRoom:messageStart', wrap)
    },
    onMessageDelta: (listener: (payload: { roomId: string; messageId: string; delta: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:messageDelta', wrap)
      return () => ipcRenderer.removeListener('chatRoom:messageDelta', wrap)
    },
    onMessageReasoning: (listener: (payload: { roomId: string; messageId: string; delta: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:messageReasoning', wrap)
      return () => ipcRenderer.removeListener('chatRoom:messageReasoning', wrap)
    },
    onMessageComplete: (listener: (payload: { roomId: string; messageId: string; message: any }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:messageComplete', wrap)
      return () => ipcRenderer.removeListener('chatRoom:messageComplete', wrap)
    },
    onMessageError: (listener: (payload: { roomId: string; messageId: string; error: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:messageError', wrap)
      return () => ipcRenderer.removeListener('chatRoom:messageError', wrap)
    },
    onTurnDone: (listener: (payload: { roomId: string; messages: any[] }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('chatRoom:turnDone', wrap)
      return () => ipcRenderer.removeListener('chatRoom:turnDone', wrap)
    },
  },

  ai: {
    applyLogs: (filter?: { bookId?: string | null; planId?: string | null; outcome?: 'success' | 'failed' | null; keyword?: string | null; limit?: number }) => ipcRenderer.invoke('ai:applyLogs', filter),
    exportApplyLogs: (filter?: { bookId?: string | null; planId?: string | null; outcome?: 'success' | 'failed' | null; keyword?: string | null; limit?: number }) => ipcRenderer.invoke('ai:exportApplyLogs', filter),
    tokenLogs: (data?: { page?: number; pageSize?: number; range?: string; modelId?: string | null; bookTitle?: string | null; action?: string | null }) => ipcRenderer.invoke('ai:tokenLogs', data),
    tokenLogFacets: () => ipcRenderer.invoke('ai:tokenLogFacets'),
    tokenSummary: () => ipcRenderer.invoke('ai:tokenSummary'),
    getSnapshot: (chapterId: string) => ipcRenderer.invoke('ai:getSnapshot', chapterId),
    getLatestSnapshot: (bookId: string) => ipcRenderer.invoke('ai:getLatestSnapshot', bookId),
    getBookMemory: (bookId: string) => ipcRenderer.invoke('ai:getBookMemory', bookId),
    listSnapshots: (bookId: string) => ipcRenderer.invoke('ai:listSnapshots', bookId),
    listSnapshotsByBook: (bookId: string) => ipcRenderer.invoke('ai:listSnapshotsByBook', bookId),
    saveSnapshot: (data: { snapshotId: string; snapshotData: any; storyTime?: string }) => ipcRenderer.invoke('ai:saveSnapshot', data),
    validateSnapshot: (data: { snapshotId: string; isValid: boolean }) => ipcRenderer.invoke('ai:validateSnapshot', data),
    applyChapterSnapshot: (data: { bookId: string; chapterId: string; snapshotData: any; cascadeDeleteAfter?: boolean }) => ipcRenderer.invoke('ai:applyChapterSnapshot', data),
    checkChapterSnapshotConflicts: (data: { bookId: string; chapterId: string }) => ipcRenderer.invoke('ai:checkChapterSnapshotConflicts', data),
    deleteChapterSnapshot: (data: { bookId: string; chapterId: string }) => ipcRenderer.invoke('ai:deleteChapterSnapshot', data),
    deleteBookMemory: (bookId: string) => ipcRenderer.invoke('ai:deleteBookMemory', bookId),
    updateBookMemory: (data: { bookId: string; data: string }) => ipcRenderer.invoke('ai:updateBookMemory', data),
    onSnapshotGenerated: (callback: (data: { chapterId: string; snapshotId: string; success: boolean }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { chapterId: string; snapshotId: string; success: boolean }) => callback(data)
      ipcRenderer.on('ai:snapshotGenerated', listener)
      return () => ipcRenderer.removeListener('ai:snapshotGenerated', listener)
    },
    reviewEditorContent: (data: { bookId: string; chapterId: string; content: string }) => ipcRenderer.invoke('ai:reviewEditorContent', data),
  },
  skill: {
    list: (opts?: { includeDisabled?: boolean }) => ipcRenderer.invoke('skill:list', opts),
    create: (data: { name: string; description?: string; prompt: string; enabled?: boolean }) => ipcRenderer.invoke('skill:create', data),
    update: (data: { id: string; name?: string; description?: string; prompt?: string; enabled?: boolean }) => ipcRenderer.invoke('skill:update', data),
    delete: (id: string) => ipcRenderer.invoke('skill:delete', id),
    invoke: (data: { skillId: string; content: string; modelId?: string | null; bookId?: string | null; bookTitle?: string | null }) => ipcRenderer.invoke('skill:invoke', data),
    importFromUrl: (data: { url: string }) => ipcRenderer.invoke('skill:importFromUrl', data),
    importZip: (buffer: Uint8Array) => ipcRenderer.invoke('skill:importZip', buffer),
  },
  // 文风指纹
  styleFingerprint: {
    list: (bookId: string) => ipcRenderer.invoke('styleFingerprint:list', bookId),
    create: (data: { bookId: string; name: string; description?: string; samples?: Array<{ title?: string; content: string }> }) =>
      ipcRenderer.invoke('styleFingerprint:create', data),
    update: (data: { id: string; name?: string; description?: string; samples?: Array<{ title?: string; content: string }> }) =>
      ipcRenderer.invoke('styleFingerprint:update', data),
    delete: (id: string) => ipcRenderer.invoke('styleFingerprint:delete', id),
    setDefault: (id: string) => ipcRenderer.invoke('styleFingerprint:setDefault', id),
    extract: (data: { id: string; modelId: string }) => ipcRenderer.invoke('styleFingerprint:extract', data),
    audit: (data: { bookId: string; content: string }) => ipcRenderer.invoke('styleFingerprint:audit', data),
    onExtractReasoning: (listener: (payload: { id: string; delta: string }) => void) => {
      const wrap = (_e: any, payload: any) => listener(payload)
      ipcRenderer.on('styleFingerprint:extractReasoning', wrap)
      return () => ipcRenderer.removeListener('styleFingerprint:extractReasoning', wrap)
    },
  },
  clip: {
    getClips: (chapterId: string) => ipcRenderer.invoke('clip:getClips', chapterId),
    listByBook: (bookId: string) => ipcRenderer.invoke('clip:listByBook', bookId),
    listByChapterRange: (bookId: string, fromOrder: number, toOrder: number) =>
      ipcRenderer.invoke('clip:listByChapterRange', bookId, fromOrder, toOrder),
    createClip: (data: { bookId: string; chapterId: string; clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; snapshotId: string }) => ipcRenderer.invoke('clip:createClip', data),
    updateClip: (id: string, data: Partial<{ clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; prevClipId: string | null; nextClipId: string | null }>) => ipcRenderer.invoke('clip:updateClip', { id, data }),
    deleteClip: (id: string) => ipcRenderer.invoke('clip:deleteClip', id),
  },
  agent: {
    run: (data: {
      streamId?: string
      bookId: string | null
      modelId: string
      chapterId?: string | null
      volumeId?: string | null
      userInput: string
      outputLanguage?: 'follow_input' | 'chinese' | 'english'
      contextDepth?: 'minimal' | 'balanced' | 'deep'
      injectWritingSettings?: boolean
      styleFingerprintId?: string | null
      streamTimeout?: number
      appliedPendingWriteTypes?: string[]
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
      writeContextVolumeOutline?: boolean
      writeContextChapterOutline?: boolean
      writeContextPrevChapterOutline?: boolean
      writeContextPrevChapterContent?: boolean
      writeContextNextChapterOutline?: boolean
    }) => ipcRenderer.invoke('agent:run', data),
    apply: (data: { write: any; modelId?: string }) => ipcRenderer.invoke('agent:apply', data),
    applyBatch: (data: { writes: any[]; modelId?: string }) => ipcRenderer.invoke('agent:applyBatch', data),
    stop: (streamId: string) => ipcRenderer.invoke('agent:stop', streamId),
    listTools: () => ipcRenderer.invoke('agent:listTools'),
    getToolPrompts: () => ipcRenderer.invoke('agent:getToolPrompts'),
    updateToolPrompt: (toolName: string, prompt: string | null) => ipcRenderer.invoke('agent:updateToolPrompt', toolName, prompt),
    getOverridesPath: () => ipcRenderer.invoke('agent:getOverridesPath'),
    onChunk: (callback: (data: { streamId: string; delta: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; delta: string }) => callback(data)
      ipcRenderer.on('agent:chunk', listener)
      return () => ipcRenderer.removeListener('agent:chunk', listener)
    },
    onReasoning: (callback: (data: { streamId: string; delta: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; delta: string }) => callback(data)
      ipcRenderer.on('agent:reasoning', listener)
      return () => ipcRenderer.removeListener('agent:reasoning', listener)
    },
    onToolStart: (callback: (data: { streamId: string; toolCall: any }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; toolCall: any }) => callback(data)
      ipcRenderer.on('agent:toolStart', listener)
      return () => ipcRenderer.removeListener('agent:toolStart', listener)
    },
    onToolEnd: (callback: (data: { streamId: string; result: any }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; result: any }) => callback(data)
      ipcRenderer.on('agent:toolEnd', listener)
      return () => ipcRenderer.removeListener('agent:toolEnd', listener)
    },
    onPendingWrite: (callback: (data: { streamId: string; write: any }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; write: any }) => callback(data)
      ipcRenderer.on('agent:pendingWrite', listener)
      return () => ipcRenderer.removeListener('agent:pendingWrite', listener)
    },
    onDone: (callback: (data: { streamId: string; content: string; usage: any; pendingWrites: any[]; toolCallHistory: any[]; aborted: boolean; errored?: boolean; errorMessage?: string | null; resumeAfterApply?: boolean; contextSnapshot?: any }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('agent:done', listener)
      return () => ipcRenderer.removeListener('agent:done', listener)
    },
    onError: (callback: (data: { streamId: string; message: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: { streamId: string; message: string }) => callback(data)
      ipcRenderer.on('agent:error', listener)
      return () => ipcRenderer.removeListener('agent:error', listener)
    },
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
