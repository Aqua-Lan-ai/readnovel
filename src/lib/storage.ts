import type { BookMeta, ChapterData } from './types'

const DB_NAME = 'dialogue-novel-reader'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('chapters')) d.createObjectStore('chapters')
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images')
    }
    req.onsuccess = () => {
      // 別的分頁要升級資料庫時,主動放開連線,避免互相卡死
      req.result.onversionchange = () => (req.result.close(), (dbPromise = null))
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('資料庫被其他分頁佔用,請關閉其他開著本程式的分頁後重新整理'))
    }
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const key = (bookId: string, i: number | string) => `${bookId}:${i}`

export const listBooks = () => run<BookMeta[]>('meta', 'readonly', (s) => s.getAll()).then((l) => l.sort((a, b) => b.addedAt - a.addedAt))
export const getMeta = (id: string) => run<BookMeta | undefined>('meta', 'readonly', (s) => s.get(id))
export const putMeta = (meta: BookMeta) => run('meta', 'readwrite', (s) => s.put(meta))
export const getChapter = (id: string, i: number) => run<ChapterData | undefined>('chapters', 'readonly', (s) => s.get(key(id, i)))
export const putChapter = (id: string, i: number, data: ChapterData) => run('chapters', 'readwrite', (s) => s.put(data, key(id, i)))

export const getImage = (id: string, path: string) => run<Blob | undefined>('images', 'readonly', (s) => s.get(key(id, path)))
export const putImage = (id: string, path: string, blob: Blob) => run('images', 'readwrite', (s) => s.put(blob, key(id, path)))

export async function deleteBook(meta: BookMeta): Promise<void> {
  await run('meta', 'readwrite', (s) => s.delete(meta.id))
  for (let i = 0; i < meta.chapterTitles.length; i++) await run('chapters', 'readwrite', (s) => s.delete(key(meta.id, i)))
  const d = await db()
  await new Promise<void>((resolve, reject) => {
    const store = d.transaction('images', 'readwrite').objectStore('images')
    const req = store.openCursor(IDBKeyRange.bound(`${meta.id}:`, `${meta.id}:\uffff`))
    req.onsuccess = () => {
      const c = req.result
      if (c) (c.delete(), c.continue())
      else resolve()
    }
    req.onerror = () => reject(req.error)
  })
}
