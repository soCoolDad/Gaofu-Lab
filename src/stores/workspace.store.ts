import { create } from 'zustand'
import type { Book, Chapter, Volume } from '@/types/api'

type WorkspaceState = {
  currentBookId: string
  currentBook: Book | null
  books: Book[]
  chapters: Chapter[]
  volumes: Volume[]
  stats: { totalWords: number; totalChapters: number; completedCount: number }
  loading: boolean
  // 正文写作设置面板选中的参考快照 id（也和"章节快照"面板共用，编辑器页面写入）；null 表示未指定
  selectedSnapshotId: string | null

  // 操作
  loadBooks: () => Promise<void>
  setCurrentBook: (id: string) => Promise<void>
  createBook: (title: string, description?: string, id?: string) => Promise<Book>
  updateBook: (id: string, data: Partial<{ title: string; description: string; detail: string; cover: string; writingStyle: string; writingPov: string; writingWordCountTarget: string; writingTaboo: string; writingConstraint: string }>) => Promise<void>
  deleteBook: (id: string) => Promise<void>
  setSelectedSnapshotId: (id: string | null) => void

  loadChapters: (bookId: string) => Promise<void>
  loadStats: (bookId: string) => Promise<void>
  createChapter: (data: { bookId: string; volumeId?: string; title: string; summary?: string; outline?: string }) => Promise<Chapter>
  bulkCreateChapters: (data: {
    bookId: string
    mode?: 'append' | 'replace'
    chapters: Array<{ title: string; summary?: string; outline?: string; volumeId?: string | null; volumeTitle?: string | null }>
  }) => Promise<void>
  updateChapter: (id: string, data: {
    title?: string
    summary?: string
    outline?: string
    content?: string
    status?: string
    volumeId?: string
  }) => Promise<void>
  deleteChapter: (id: string) => Promise<void>

  loadVolumes: (bookId: string) => Promise<void>
  createVolume: (data: { bookId: string; title: string; description?: string; outline?: string; sortOrder?: number }) => Promise<Volume>
  bulkCreateVolumes: (data: {
    bookId: string
    mode?: 'append' | 'replace'
    volumes: Array<{ title: string; description?: string; outline?: string }>
  }) => Promise<void>
  updateVolume: (id: string, data: Partial<{ title: string; description: string; outline: string; sortOrder: number }>) => Promise<void>
  deleteVolume: (id: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentBookId: '',
  currentBook: null,
  books: [],
  chapters: [],
  volumes: [],
  stats: { totalWords: 0, totalChapters: 0, completedCount: 0 },
  loading: false,
  selectedSnapshotId: null,
  setSelectedSnapshotId: (id) => set({ selectedSnapshotId: id }),

  loadBooks: async () => {
    const books = await window.api.book.list()
    set({ books })
    const currentId = get().currentBookId
    const currentBookExists = currentId && books.some((b) => b.id === currentId)
    if (!currentBookExists) {
      if (books.length > 0) {
        await get().setCurrentBook(books[0].id)
      } else {
        set({ currentBookId: '', currentBook: null, chapters: [], volumes: [], stats: { totalWords: 0, totalChapters: 0, completedCount: 0 } })
      }
    }
  },

  setCurrentBook: async (id: string) => {
    // 切书期间置 loading，供 WorkspaceLayout / 页面显示骨架屏
    set({ loading: true })
    try {
      const book = id ? await window.api.book.get(id) : null
      if (id && !book) {
        set({ currentBookId: '', currentBook: null, chapters: [], volumes: [], stats: { totalWords: 0, totalChapters: 0, completedCount: 0 } })
        return
      }
      set({ currentBookId: id || '', currentBook: book })
      if (id) {
        // 后台加载数据，不阻塞 UI 响应（页面本身的 useEffect 也会触发加载）
        get().loadChapters(id)
        get().loadVolumes(id)
        get().loadStats(id)
      }
    } finally {
      set({ loading: false })
    }
  },

  createBook: async (title, description, id) => {
    const book = await window.api.book.create({ id, title, description })
    set((s) => ({ books: [book, ...s.books] }))
    await get().setCurrentBook(book.id)
    return book
  },

  updateBook: async (id, data) => {
    const book = await window.api.book.update(id, data)
    set((s) => ({
      books: s.books.map((b) => (b.id === id ? book : b)),
      currentBook: s.currentBookId === id ? book : s.currentBook,
    }))
  },

  deleteBook: async (id) => {
    await window.api.book.delete(id)
    const { books } = get()
    const remaining = books.filter((b) => b.id !== id)
    set({ books: remaining })
    if (remaining.length > 0) {
      await get().setCurrentBook(remaining[0].id)
    } else {
      set({ currentBookId: '', currentBook: null, chapters: [], volumes: [], stats: { totalWords: 0, totalChapters: 0, completedCount: 0 } })
    }
  },

  loadChapters: async (bookId) => {
    const chapters = await window.api.chapter.list(bookId)
    set({ chapters })
  },

  loadStats: async (bookId) => {
    const stats = await window.api.chapter.stats(bookId)
    set({ stats })
  },

  createChapter: async (data) => {
    const chapter = await window.api.chapter.create(data)
    set((s) => ({ chapters: [...s.chapters, chapter] }))
    await get().loadStats(get().currentBookId)
    return chapter
  },

  bulkCreateChapters: async (data) => {
    const chapters = await window.api.chapter.bulkCreate(data)
    set({ chapters })
    await get().loadStats(data.bookId)
  },

  updateChapter: async (id, data) => {
    const chapter = await window.api.chapter.update(id, data)
    set((s) => ({
      chapters: s.chapters.map((c) => (c.id === id ? chapter : c)),
    }))
    await get().loadStats(get().currentBookId)
  },

  deleteChapter: async (id) => {
    await window.api.chapter.delete(id)
    set((s) => ({ chapters: s.chapters.filter((c) => c.id !== id) }))
    await get().loadStats(get().currentBookId)
  },

  loadVolumes: async (bookId) => {
    const volumes = await window.api.volume.list(bookId)
    set({ volumes })
  },

  createVolume: async (data) => {
    const volume = await window.api.volume.create(data)
    set((s) => ({ volumes: [...s.volumes, volume] }))
    return volume
  },

  bulkCreateVolumes: async (data) => {
    const volumes = await window.api.volume.bulkCreate(data)
    set({ volumes })
  },

  updateVolume: async (id, data) => {
    await window.api.volume.update(id, data)
    set((s) => ({
      volumes: s.volumes.map((v) => (v.id === id ? { ...v, ...data } : v)),
    }))
  },

  deleteVolume: async (id) => {
    await window.api.volume.delete(id)
    set((s) => ({ volumes: s.volumes.filter((v) => v.id !== id) }))
  },
}))
