import type { RawChapter } from './types'

const HEADING_RE = new RegExp(
  '^(?:' +
    '第\\s*[0-9零〇一二三四五六七八九十百千兩两]+\\s*[章回節节卷集部篇幕話话].{0,40}' +
    '|Chapter\\s*\\d+.{0,40}' +
    '|(?:序章|楔子|序幕|尾聲|尾声|終章|终章|後記|后记|番外).{0,30}' +
    ')$',
  'i',
)

export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[\s　]+|[\s　]+$/g, ''))
    .filter(Boolean)
}

const isHeading = (line: string) => line.length <= 50 && HEADING_RE.test(line) && !/[。！？]$/.test(line)

/** 依章節標題切章;找不到標題時依長度切段。 */
export function splitChapters(text: string, fallbackTitle = '正文'): RawChapter[] {
  const paras = toParagraphs(text)
  const chapters: RawChapter[] = []
  let cur: { title: string; lines: string[] } | null = null
  const flush = () => {
    if (cur && cur.lines.length) chapters.push({ title: cur.title, text: cur.lines.join('\n') })
  }
  for (const p of paras) {
    if (isHeading(p)) {
      flush()
      cur = { title: p, lines: [] }
    } else {
      cur ??= { title: '前言', lines: [] }
      cur.lines.push(p)
    }
  }
  flush()

  if (chapters.length >= 2) return chapters

  // 沒有章節標題:約每 4000 字一段
  const out: RawChapter[] = []
  let buf: string[] = []
  let len = 0
  for (const p of paras) {
    buf.push(p)
    len += p.length
    if (len >= 4000) {
      out.push({ title: `${fallbackTitle} ${out.length + 1}`, text: buf.join('\n') })
      buf = []
      len = 0
    }
  }
  if (buf.length) out.push({ title: out.length ? `${fallbackTitle} ${out.length + 1}` : fallbackTitle, text: buf.join('\n') })
  return out
}

/** 場景分隔線(＊ ● ◆ ─── 等) */
export const SCENE_BREAK = /^[\s＊*●◆◇■□○◎※★☆─—＝=~～・.．‧]{1,12}$/

const SPLIT_OVER = 40000
const PART_TARGET = 15000

/** 單章過長(整章塞在一個檔案)時,優先在場景分隔線處切成多段,方便載入與閱讀。 */
export function splitLongChapters(chapters: RawChapter[]): RawChapter[] {
  return chapters.flatMap((c) => {
    if (c.text.length <= SPLIT_OVER) return [c]
    const parts: string[][] = [[]]
    let len = 0
    for (const line of c.text.split('\n')) {
      parts[parts.length - 1].push(line)
      len += line.length
      const atBreak = SCENE_BREAK.test(line)
      if ((atBreak && len >= PART_TARGET) || len >= PART_TARGET * 2) {
        parts.push([])
        len = 0
      }
    }
    const texts = parts.map((p) => p.join('\n')).filter((t) => t.trim())
    // 最後一段太短就併回前一段
    if (texts.length > 1 && texts[texts.length - 1].length < PART_TARGET / 3) texts.splice(-2, 2, texts.slice(-2).join('\n'))
    return texts.map((text, i) => ({ title: texts.length > 1 ? `${c.title}(${i + 1}/${texts.length})` : c.title, text }))
  })
}
