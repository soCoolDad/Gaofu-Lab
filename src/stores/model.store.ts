import { create } from 'zustand'
import type { ModelProvider } from '@/types/api'

type ModelStore = {
  models: ModelProvider[]
  loadModels: () => Promise<void>
  createModel: (data: {
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
  }) => Promise<ModelProvider>
  updateModel: (id: string, data: Partial<{
    name: string; provider: string; apiKey: string; modelName: string
    baseUrl?: string; inputPrice?: number; outputPrice?: number; cachedInputPrice?: number; enabled: boolean
    maxOutputTokens?: number; maxContextTokens?: number
  }>) => Promise<void>
  deleteModel: (id: string) => Promise<void>
}

export const useModelStore = create<ModelStore>((set, get) => ({
  models: [],
  loadModels: async () => {
    const models = await window.api.model.list()
    set({ models })
  },
  createModel: async (data) => {
    const model = await window.api.model.create(data)
    set((s) => ({ models: [model, ...s.models] }))
    return model
  },
  updateModel: async (id, data) => {
    const model = await window.api.model.update(id, data)
    set((s) => ({ models: s.models.map((m) => (m.id === id ? model : m)) }))
  },
  deleteModel: async (id) => {
    await window.api.model.delete(id)
    set((s) => ({ models: s.models.filter((m) => m.id !== id) }))
  },
}))
