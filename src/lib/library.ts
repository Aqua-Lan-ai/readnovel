import { splitLongChapters } from './chapters'
import { detectInWorker, yieldUI } from './detectInWorker'
import { loadEpub, loadTxt, type Progress } from './loaders'
import { getChapter, getImage, putChapter, putImage, putMeta } from './storage'
import type { BookMeta, ChapterData, Correction, Message, TypeRule } from './types'

const EXPORT_FORMAT = 'dialogue-novel-reader'

interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1
  book: { title: string; characters: string[]; me: string | null; typeRules?: TypeRule[]; firstPerson?: boolean; aliases?: Record<string, string> }
  chapters: { index: number; title: string; text?: string; messages?: Message[] }[]
  images?: { path: string; dataUrl: string }[]
  corrections: Correction[]
}

const newId = () => crypto.randomUUID()

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

async function save(meta: BookMeta, chapters: ChapterData[], onProgress?: Progress): Promise<BookMeta> {
  for (let i = 0; i < chapters.length; i++) {
    if (i % 5 === 0) onProgress?.(`儲存中 ${i + 1} / ${chapters.length}`, i / chapters.length)
    await putChapter(meta.id, i, chapters[i])
  }
  await putMeta(meta)
  return meta
}

export async function importFile(file: File, onProgress?: Progress): Promise<BookMeta> {
  const lower = file.name.toLowerCase()
  onProgress?.('讀取檔案…')
  await yieldUI()
  if (lower.endsWith('.json')) return importJson(JSON.parse(await file.text()))

  const raw = lower.endsWith('.epub') ? await loadEpub(file, onProgress) : await loadTxt(file)
  const loaded = { ...raw, chapters: splitLongChapters(raw.chapters) }
  if (!loaded.chapters.length) throw new Error('檔案內沒有可讀取的文字')
  onProgress?.('分析角色名單…(內容多時需要幾秒)')
  const detected = await detectInWorker(loaded.chapters.map((c) => c.text).join('\n'))
  const characters = detected.firstPerson ? ['我', ...detected.names] : detected.names
  const meta: BookMeta = {
    id: newId(),
    title: loaded.title,
    addedAt: Date.now(),
    chapterTitles: loaded.chapters.map((c) => c.title),
    characters,
    me: characters[0] ?? null,
    firstPerson: detected.firstPerson,
    progress: { chapter: 0, scroll: 0 },
    corrections: [],
  }
  for (const img of loaded.images ?? []) await putImage(meta.id, img.path, img.blob)
  return save(meta, loaded.chapters.map((c) => ({ text: c.text })), onProgress)
}

async function importJson(data: ExportFile): Promise<BookMeta> {
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.chapters)) throw new Error('這不是本程式匯出的解析檔')
  const chapters = [...data.chapters].sort((a, b) => a.index - b.index)
  const meta: BookMeta = {
    id: newId(),
    title: data.book.title,
    addedAt: Date.now(),
    chapterTitles: chapters.map((c) => c.title),
    characters: data.book.characters,
    me: data.book.me,
    typeRules: data.book.typeRules,
    firstPerson: data.book.firstPerson,
    aliases: data.book.aliases,
    progress: { chapter: 0, scroll: 0 },
    corrections: data.corrections ?? [],
  }
  for (const img of data.images ?? []) await putImage(meta.id, img.path, await (await fetch(img.dataUrl)).blob())
  return save(meta, chapters.map((c) => ({ text: c.text ?? '', messages: c.messages })))
}

export async function exportBook(meta: BookMeta): Promise<void> {
  const chapters: ExportFile['chapters'] = []
  for (let i = 0; i < meta.chapterTitles.length; i++) {
    const data = (await getChapter(meta.id, i)) ?? { text: '' }
    chapters.push({
      index: i,
      title: meta.chapterTitles[i],
      // 已解析的章節只存結果;未解析的保留原文,匯入後仍可繼續讀
      ...(data.messages ? { messages: data.messages } : { text: data.text }),
    })
  }
  const paths = new Set<string>()
  for (const c of chapters) {
    for (const m of c.messages ?? []) if (m.type === 'image') paths.add(m.text)
    for (const x of (c.text ?? '').matchAll(/⟦img:(.+?)⟧/g)) paths.add(x[1])
  }
  const images: NonNullable<ExportFile['images']> = []
  for (const path of paths) {
    const blob = await getImage(meta.id, path)
    if (blob) images.push({ path, dataUrl: await blobToDataUrl(blob) })
  }
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: 1,
    book: { title: meta.title, characters: meta.characters, me: meta.me, typeRules: meta.typeRules, firstPerson: meta.firstPerson, aliases: meta.aliases },
    chapters,
    corrections: meta.corrections,
    images,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${meta.title}.dialogue.json`
  a.click()
  URL.revokeObjectURL(url)
}
