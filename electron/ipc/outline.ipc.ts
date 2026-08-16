import { ipcMain } from 'electron'
import { getDb } from '../db'
import { outlines } from '../db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

function now() {
  return new Date().toISOString()
}

export function registerOutlineIpc() {
  ipcMain.handle('outline:getBook', async (_, bookId: string) => {
    const db = getDb()
    return db
      .select()
      .from(outlines)
      .where(and(eq(outlines.bookId, bookId), eq(outlines.type, 'book'), isNull(outlines.targetId)))
      .get() ?? null
  })

  ipcMain.handle('outline:saveBook', async (_, bookId: string, content: string) => {
    const db = getDb()
    const existing = db
      .select()
      .from(outlines)
      .where(and(eq(outlines.bookId, bookId), eq(outlines.type, 'book'), isNull(outlines.targetId)))
      .get()

    if (existing) {
      db.update(outlines).set({ content, updatedAt: now() }).where(eq(outlines.id, existing.id)).run()
      return db.select().from(outlines).where(eq(outlines.id, existing.id)).get()
    }

    const id = uuidv4()
    db.insert(outlines).values({
      id,
      bookId,
      type: 'book',
      targetId: null,
      content,
      updatedAt: now(),
    }).run()
    return db.select().from(outlines).where(eq(outlines.id, id)).get()
  })
}
