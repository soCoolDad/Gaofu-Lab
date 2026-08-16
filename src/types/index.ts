export type Book = {
  id: string
  title: string
  description?: string
  cover?: string
  createdAt: string
  updatedAt: string
}

export type Volume = {
  id: string
  bookId: string
  title: string
  description?: string
  sortOrder: number
}

export type Chapter = {
  id: string
  bookId: string
  volumeId?: string
  title: string
  summary?: string
  content: string
  wordCount: number
  status: 'draft' | 'locked' | 'completed' | 'finalized'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type Outline = {
  id: string
  bookId: string
  type: 'book' | 'volume' | 'chapter'
  targetId?: string
  content: string
  updatedAt: string
}

export type Foreshadowing = {
  id: string
  bookId: string
  title: string
  description: string
  status: 'open' | 'resolved'
  introducedChapterId?: string
  resolvedChapterId?: string
  tags: string[]
}

export type WorldLine = {
  id: string
  bookId: string
  title: string
  description: string
  color?: string
}

export type Inspiration = {
  id: string
  bookId: string
  content: string
  tags: string[]
  createdAt: string
}

export type Tag = {
  id: string
  bookId?: string
  name: string
  type: 'character' | 'foreshadowing' | 'worldline' | 'ai' | 'custom'
  parentId?: string
  sortOrder: number
}

export type ModelProvider = {
  id: string
  name: string
  provider:
    | 'deepseek'
    | 'doubao'
    | 'qianwen'
    | 'openai-compatible'
    | 'custom'
  baseUrl?: string
  apiKey: string
  modelName: string
  inputPrice?: number
  outputPrice?: number
  enabled: boolean
}
