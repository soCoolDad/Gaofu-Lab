import { ipcMain, safeStorage } from 'electron'
import { getDb } from '../db'
import { modelProviders } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

function now() {
  return new Date().toISOString()
}

export type DecodedModel = Omit<typeof modelProviders.$inferSelect, 'apiKey'> & { apiKey: string }

const ENC_PREFIX = 'ENCv1:'

export function encryptApiKey(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plain)
    return ENC_PREFIX + encrypted.toString('base64')
  }
  return Buffer.from(plain, 'utf-8').toString('base64')
}

export function decryptApiKey(stored: string | null | undefined): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    const b64 = stored.slice(ENC_PREFIX.length)
    try {
      const buf = Buffer.from(b64, 'base64')
      if (!safeStorage.isEncryptionAvailable()) return ''
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  }
  try {
    const buf = Buffer.from(stored, 'base64')
    return buf.toString('utf-8')
  } catch {
    return stored
  }
}

export function decodeModelApiKey<T extends { apiKey: string } | null | undefined>(model: T): T extends null | undefined ? T : Omit<T, 'apiKey'> & { apiKey: string } {
  if (!model) return model as any
  return { ...(model as any), apiKey: decryptApiKey((model as any).apiKey) }
}

export function registerModelIpc() {
  ipcMain.handle('model:list', async () => {
    const db = getDb()
    const rows = db.select().from(modelProviders).orderBy(desc(modelProviders.createdAt)).all()
    return rows.map((row) => decodeModelApiKey(row))
  })

  ipcMain.handle('model:get', async (_, id: string) => {
    const db = getDb()
    const row = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get() ?? null
    return decodeModelApiKey(row)
  })

  ipcMain.handle('model:fetchModels', async (_, baseUrl: string, apiKey: string) => {
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const statusText = response.statusText || '未知错误'
        throw new Error(`请求失败: HTTP ${response.status} ${statusText}`)
      }

      const data = await response.json()

      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        return data.data.map((m: any) => {
          const model: any = {
            id: m.id,
            name: m.id,
          }

          const extractPrice = (inputPrice: any, outputPrice: any) => {
            const convertPrice = (price: any): number | undefined => {
              if (typeof price === 'number') {
                if (price < 0.01) {
                  return price * 1000000
                }
                return price
              }
              return undefined
            }

            const input = convertPrice(inputPrice)
            const output = convertPrice(outputPrice)

            return { input, output }
          }

          let inputPrice: number | undefined
          let outputPrice: number | undefined

          if (m.pricing) {
            const prices = extractPrice(m.pricing.prompt_token_price, m.pricing.completion_token_price)
            inputPrice = prices.input
            outputPrice = prices.output
          }

          if (m.pricing_details) {
            const prices = extractPrice(m.pricing_details.input, m.pricing_details.output)
            if (!inputPrice) inputPrice = prices.input
            if (!outputPrice) outputPrice = prices.output
          }

          if (m.input_price_per_token || m.output_price_per_token) {
            const prices = extractPrice(m.input_price_per_token, m.output_price_per_token)
            if (!inputPrice) inputPrice = prices.input
            if (!outputPrice) outputPrice = prices.output
          }

          if (m.price_info || m.pricingInfo) {
            const pi = m.price_info || m.pricingInfo
            const prices = extractPrice(pi.input, pi.output)
            if (!inputPrice) inputPrice = prices.input
            if (!outputPrice) outputPrice = prices.output
          }

          if (m.inputPrice || m.outputPrice) {
            const prices = extractPrice(m.inputPrice, m.outputPrice)
            if (!inputPrice) inputPrice = prices.input
            if (!outputPrice) outputPrice = prices.output
          }

          if (inputPrice !== undefined) model.inputPrice = inputPrice
          if (outputPrice !== undefined) model.outputPrice = outputPrice

          return model
        })
      }

      throw new Error('未获取到模型列表')
    } catch (error) {
      throw error
    }
  })

  ipcMain.handle('model:create', async (_, data: {
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
  }) => {
    try {
      const db = getDb()
      if (!data?.name) throw new Error('name 不能为空')
      if (!data?.provider) throw new Error('provider 不能为空')
      if (!data?.modelName) throw new Error('modelId (modelName 字段) 不能为空')
      const id = uuidv4()
      const ts = now()
      db.insert(modelProviders).values({
        id,
        name: data.name,
        provider: data.provider,
        apiKey: encryptApiKey(data.apiKey ?? ''),
        baseUrl: data.baseUrl ?? null,
        modelName: data.modelName,
        inputPrice: data.inputPrice ?? null,
        outputPrice: data.outputPrice ?? null,
        cachedInputPrice: data.cachedInputPrice ?? null,
        maxOutputTokens: data.maxOutputTokens ?? null,
        maxContextTokens: data.maxContextTokens ?? null,
        temperature: data.temperature ?? null,
        topP: data.topP ?? null,
        frequencyPenalty: data.frequencyPenalty ?? null,
        presencePenalty: data.presencePenalty ?? null,
        billingRules: data.billingRules ?? null,
        mergeSystemMessages: data.mergeSystemMessages ?? false,
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      const row = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get()
      if (!row) throw new Error('创建后查询失败，数据未入库')
      return decodeModelApiKey(row)
    } catch (err: any) {
      console.error('[model:create] 失败:', err)
      // better-sqlite3/drizzle 抛错时 message 可能是英文，原样透出给前端展示，便于定位
      throw new Error(err?.message || String(err))
    }
  })

  ipcMain.handle('model:update', async (_, id: string, data: Partial<{
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
    enabled: boolean
    mergeSystemMessages?: boolean
  }>) => {
    try {
      const db = getDb()
      if (!id) throw new Error('id 不能为空')
      const updateData: Record<string, any> = { ...data, updatedAt: now() }
      if (typeof data.apiKey === 'string') {
        updateData.apiKey = encryptApiKey(data.apiKey)
      }
      db.update(modelProviders).set(updateData).where(eq(modelProviders.id, id)).run()
      const row = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get()
      if (!row) throw new Error('更新后未找到对应记录')
      return decodeModelApiKey(row)
    } catch (err: any) {
      console.error('[model:update] 失败:', err)
      throw new Error(err?.message || String(err))
    }
  })

  ipcMain.handle('model:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(modelProviders).where(eq(modelProviders.id, id)).run()
    return true
  })
}
