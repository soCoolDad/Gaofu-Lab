import { ipcMain } from 'electron'
import { getDb } from '../db'
import { bookSettingEntries } from '../db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const settingTypes = new Set(['characters', 'locations', 'items', 'skills', 'scenes', 'factions', 'systems', 'inspirations', 'foreshadowings'])

function now() {
  return new Date().toISOString()
}

function assertSettingType(type: string) {
  if (!settingTypes.has(type)) throw new Error('未知设定类型')
}

export function registerBookSettingIpc() {
  ipcMain.handle('bookSetting:list', async (_, data: { bookId: string; type: string }) => {
    assertSettingType(data.type)
    const db = getDb()
    return db.select().from(bookSettingEntries).where(and(eq(bookSettingEntries.bookId, data.bookId), eq(bookSettingEntries.type, data.type))).orderBy(asc(bookSettingEntries.createdAt)).all()
  })

  ipcMain.handle('bookSetting:listAll', async (_, bookId: string) => {
    const db = getDb()
    return db.select().from(bookSettingEntries).where(eq(bookSettingEntries.bookId, bookId)).orderBy(asc(bookSettingEntries.type), asc(bookSettingEntries.createdAt)).all()
  })

  ipcMain.handle('bookSetting:create', async (_, data: { bookId: string; type: string; name: string; description?: string; detail?: string }) => {
    assertSettingType(data.type)
    const db = getDb()
    const id = uuidv4()
    const ts = now()
    db.insert(bookSettingEntries).values({
      id,
      bookId: data.bookId,
      type: data.type,
      name: data.name,
      description: data.description || '',
      detail: data.detail || '',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(bookSettingEntries).where(eq(bookSettingEntries.id, id)).get()
  })

  ipcMain.handle('bookSetting:update', async (_, id: string, data: Partial<{ name: string; description: string; detail: string }>) => {
    const db = getDb()
    db.update(bookSettingEntries).set({ ...data, updatedAt: now() }).where(eq(bookSettingEntries.id, id)).run()
    return db.select().from(bookSettingEntries).where(eq(bookSettingEntries.id, id)).get()
  })

  ipcMain.handle('bookSetting:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(bookSettingEntries).where(eq(bookSettingEntries.id, id)).run()
    return true
  })
}
