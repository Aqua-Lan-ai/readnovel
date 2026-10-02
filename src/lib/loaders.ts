import JSZip from 'jszip'
import { splitChapters, toParagraphs } from './chapters'
import { yieldUI } from './detectInWorker'
import { IMG_MARK } from './parser'
import type { RawChapter } from './types'

export interface LoadedBook {
  title: string
  chapters: RawChapter[]
  images?: { path: string; blob: Blob }[]
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '')

/** 常用字(繁簡並列),用來比較不同解碼結果哪個比較像正常中文 */
const COMMON =
  new Set([...'的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實回二理美點月明問力' +
    '这们为说么里后时会对发经见动两长样现将与进实点问国个学来当无开头种见'])

const score = (s: string) => {
  let n = 0
  for (const ch of s) {
    if (COMMON.has(ch)) n += 1
    else if (ch === '\uFFFD') n -= 5
  }
  return n
}

/** UTF-16:有 BOM,或檔案含大量 0x00(UTF-8/GBK/Big5 的文字檔幾乎不會有);再用字元分數分辨大小端 */
function detectUtf16(bytes: Uint8Array, buf: ArrayBuffer): 'utf-16le' | 'utf-16be' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  const n = Math.min(bytes.length, 8000)
  let nul = 0
  for (let i = 0; i < n; i++) if (bytes[i] === 0) nul++
  if (n < 20 || nul < n * 0.005) return null
  const sample = buf.slice(0, n & ~1)
  return score(new TextDecoder('utf-16le').decode(sample)) >= score(new TextDecoder('utf-16be').decode(sample)) ? 'utf-16le' : 'utf-16be'
}

export function decodeText(buf: ArrayBuffer): string {
  const utf16 = detectUtf16(new Uint8Array(buf), buf)
  if (utf16) return new TextDecoder(utf16).decode(buf).replace(/^\uFEFF/, '')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    const gb = new TextDecoder('gb18030').decode(buf)
    const big5 = new TextDecoder('big5').decode(buf)
    return score(big5) > score(gb) ? big5 : gb
  }
}

export async function loadTxt(file: File): Promise<LoadedBook> {
  const text = decodeText(await file.arrayBuffer())
  return { title: stripExt(file.name), chapters: splitChapters(text) }
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TR', 'SECTION', 'BR'])

function htmlToLines(doc: Document, docDir: string): string[] {
  doc.querySelectorAll('script,style,rt,rp').forEach((n) => n.remove())
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ''
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase()
      if (tag === 'img' || tag === 'image') {
        const el = node as Element
        const src = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href')
        if (src && !src.startsWith('data:')) out += `\n⟦img:${resolvePath(docDir, src)}⟧\n`
        return
      }
      const block = BLOCK.has((node as Element).tagName.toUpperCase())
      if (block) out += '\n'
      node.childNodes.forEach(walk)
      if (block) out += '\n'
    }
  }
  walk(doc.body ?? doc.documentElement)
  return toParagraphs(out)
}

function resolvePath(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split('#')[0])).split('/')
  const stack: string[] = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p && p !== '.') stack.push(p)
  }
  return stack.join('/')
}

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')

export type Progress = (text: string, ratio?: number) => void

export async function loadEpub(file: File, onProgress?: Progress): Promise<LoadedBook> {
  onProgress?.('解壓縮 EPUB…')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const read = async (path: string) => {
    const f = zip.file(path)
    if (!f) throw new Error(`EPUB 內找不到 ${path}`)
    return f.async('string')
  }

  const container = parseXml(await read('META-INF/container.xml'))
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('無法解析 EPUB(找不到 OPF)')
  const opf = parseXml(await read(opfPath))
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || stripExt(file.name)
  const manifest = new Map<string, { href: string; props: string }>()
  opf.querySelectorAll('manifest > item').forEach((it) =>
    manifest.set(it.getAttribute('id')!, { href: it.getAttribute('href')!, props: it.getAttribute('properties') ?? '' }),
  )

  const chapters: RawChapter[] = []
  let pendingImages: string[] = []
  const textLen = (lines: string[]) => lines.filter((l) => !IMG_MARK.test(l)).join('').length
  const refs = Array.from(opf.querySelectorAll('spine > itemref'))
  for (const [n, ref] of refs.entries()) {
    onProgress?.(`讀取章節 ${n + 1} / ${refs.length}`, n / refs.length)
    await yieldUI()
    const item = manifest.get(ref.getAttribute('idref')!)
    if (!item || /\bnav\b/.test(item.props)) continue
    let html: string
    const itemPath = resolvePath(baseDir, item.href)
    try {
      html = await read(itemPath)
    } catch {
      continue
    }
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim()
    const lines = htmlToLines(doc, itemPath.includes('/') ? itemPath.slice(0, itemPath.lastIndexOf('/') + 1) : '')
    if (textLen(lines) < 30) {
      // 封面/插圖頁:圖片併入下一個章節開頭
      pendingImages.push(...lines.filter((l) => IMG_MARK.test(l)))
      continue
    }
    const first = lines.find((l) => !IMG_MARK.test(l))!
    const chTitle = heading || (first.length <= 30 ? first : `第 ${chapters.length + 1} 節`)
    const at = lines.indexOf(first)
    if (first === chTitle) lines.splice(at, 1)
    chapters.push({ title: chTitle, text: [...pendingImages, ...lines].join('\n') })
    pendingImages = []
  }
  if (pendingImages.length && chapters.length) chapters[chapters.length - 1].text += '\n' + pendingImages.join('\n')

  onProgress?.('擷取插圖…')
  await yieldUI()
  const images: { path: string; blob: Blob }[] = []
  for (const path of new Set(chapters.flatMap((c) => [...c.text.matchAll(/⟦img:(.+?)⟧/g)].map((m) => m[1])))) {
    const f = zip.file(path)
    if (!f) continue
    const ext = path.split('.').pop()!.toLowerCase()
    images.push({ path, blob: new Blob([await f.async('arraybuffer')], { type: MIME[ext] ?? 'image/jpeg' }) })
  }

  // 整本塞在一兩個 HTML 檔裡:改用章節標題重新切
  const total = chapters.reduce((n, c) => n + c.text.length, 0)
  if (chapters.length <= 2 && total > 20000) {
    return { title, images, chapters: splitChapters(chapters.map((c) => `${c.title}\n${c.text}`).join('\n')) }
  }
  if (!chapters.length) throw new Error('EPUB 內沒有可讀取的文字內容')
  return { title, chapters, images }
}
