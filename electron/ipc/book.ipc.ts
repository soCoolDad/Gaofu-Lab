import { ipcMain } from 'electron'
import { getDb } from '../db'
import { books, aiChatMessages } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

function now() {
  return new Date().toISOString()
}

export function registerBookIpc() {
  // 查询所有书籍
  ipcMain.handle('book:list', async () => {
    const db = getDb()
    return db.select().from(books).orderBy(desc(books.updatedAt)).all()
  })

  // 查询单个书籍
  ipcMain.handle('book:get', async (_, id: string) => {
    const db = getDb()
    return db.select().from(books).where(eq(books.id, id)).get() ?? null
  })

  // 创建书籍
  ipcMain.handle('book:create', async (_, data: { id?: string; title: string; description?: string; detail?: string }) => {
    const db = getDb()
    const id = data.id || uuidv4()
    const ts = now()
    db.insert(books).values({
      id,
      title: data.title,
      description: data.description ?? '',
      detail: data.detail ?? '',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(books).where(eq(books.id, id)).get()
  })

  // 更新书籍
  ipcMain.handle('book:update', async (_, id: string, data: Partial<{
    title: string
    description: string
    detail: string
    cover: string
    writingStyle: string
    writingPov: string
    writingWordCountTarget: string
    writingTaboo: string
    writingConstraint: string
  }>) => {
    const db = getDb()
    db.update(books).set({ ...data, updatedAt: now() }).where(eq(books.id, id)).run()
    return db.select().from(books).where(eq(books.id, id)).get()
  })

  // 删除书籍
  ipcMain.handle('book:delete', async (_, id: string) => {
    const db = getDb()
    db.delete(books).where(eq(books.id, id)).run()
    // 级联清理聊天记录（ai_chat_messages 无外键约束，需手动删除）
    db.delete(aiChatMessages).where(eq(aiChatMessages.bookId, id)).run()
    return true
  })
}
