import { SCENE_BREAK, toParagraphs } from './chapters'
import { alt, MODIFIERS, SHOUT_RE, SHOUT_VERBS, SPEECH_VERBS, SPEECH_RE, THOUGHT_RE, THOUGHT_VERBS } from './lexicon'
import type { Message, MsgType, TypeRule } from './types'

export interface ParseContext {
  names: string[]
  typeRules: TypeRule[]
  firstPerson: boolean
  /** 原文寫法 → 顯示名稱 */
  aliases: Record<string, string>
  /** 比對說話標註用(第一人稱時含「我」) */
  nameRe: RegExp | null
  /** 推測說話者用(不含「我」,否則每段旁白都會命中) */
  inferRe: RegExp | null
  thoughtRe: RegExp
  /** 弱動詞「想,」:必須有人名或代詞當主詞,避免「這麼想,但…」被切斷 */
  weakThoughtRe: RegExp
}

export function createContext(
  allNames: string[],
  typeRules: TypeRule[] = [],
  firstPerson = false,
  aliases: Record<string, string> = {},
): ParseContext {
  const names = [...new Set([...allNames, ...Object.keys(aliases)])].filter((n) => n !== '我')
  const nameAlt = alt(names)
  const verbs = alt(THOUGHT_VERBS.filter((v) => v !== '想'))
  const mods = alt(MODIFIERS)
  return {
    names,
    typeRules,
    firstPerson,
    aliases,
    nameRe: names.length || firstPerson ? new RegExp(firstPerson ? alt([...names, '我']) : nameAlt, 'g') : null,
    inferRe: names.length ? new RegExp(nameAlt, 'g') : null,
    thoughtRe: new RegExp(`(${names.length ? nameAlt : '(?!)'})?(?:${mods})*(${verbs})[，,：:]?(.{2,})$`),
    weakThoughtRe: new RegExp(`(${names.length ? nameAlt + '|' : ''}[他她它牠我])(?:${mods})*(想)[，,：:](.{2,})$`),
  }
}

type Kind = 'speech' | 'thought' | 'shout'
interface Attribution {
  kind: Kind
  speaker: string | null
  /** 由說話動詞判定(而非只靠人名鄰近) */
  viaVerb: boolean
}

/** 解析中的訊息:quote 表示來自引號(對話/想法),explicit 表示說話者有明確標註 */
type Raw = Omit<Message, 'id'> & { quote?: boolean; explicit?: boolean; scene?: boolean }

const WINDOW = 15
const MAX_CONSUMED_LEN = 25
const OPENERS: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"' }
const ADDRESSEE_PREFIX = /[對对向跟朝問问叫喊給给]$/

interface Seg {
  kind: 'text' | 'quote'
  text: string
  open?: string
  close?: string
}

/** 找對應的收尾引號,同種引號巢狀(「…「名字」…」)時要配對 */
function findClose(para: string, from: number, open: string, close: string): number {
  if (open === close) return para.indexOf(close, from + 1)
  let depth = 0
  for (let k = from + 1; k < para.length; k++) {
    if (para[k] === open) depth++
    else if (para[k] === close && depth-- === 0) return k
  }
  return -1
}

function tokenize(para: string): Seg[] {
  const segs: Seg[] = []
  let buf = ''
  let i = 0
  const pushText = () => {
    if (buf) segs.push({ kind: 'text', text: buf })
    buf = ''
  }
  while (i < para.length) {
    const ch = para[i]
    const close = OPENERS[ch]
    if (close) {
      let j = findClose(para, i, ch, close)
      // 直式引號沒闔上:延伸到段尾;半形引號沒闔上:當一般文字
      if (j < 0 && ch !== '"') j = para.length
      if (j >= 0) {
        const inner = para.slice(i + 1, j).trim()
        if (/[\p{L}\p{N}]/u.test(inner)) {
          pushText()
          segs.push({ kind: 'quote', text: inner, open: ch, close })
          i = j + 1
          continue
        }
      }
    }
    buf += ch
    i++
  }
  pushText()
  return segs
}

function classify(win: string): Kind | null {
  if (THOUGHT_RE.test(win) && !/(?:說|说|問|问|答)[，,：:]?$/.test(win)) return 'thought'
  if (SHOUT_RE.test(win)) return 'shout'
  if (SPEECH_RE.test(win)) return 'speech'
  return null
}

function findName(win: string, side: 'before' | 'after', ctx: ParseContext): { name: string; index: number } | null {
  if (!ctx.nameRe) return null
  const hits = [...win.matchAll(ctx.nameRe)].filter(
    (m) =>
      !ADDRESSEE_PREFIX.test(win.slice(0, m.index)) &&
      // 「我」要排除「我們」「自我」「無我」等
      (m[0] !== '我' || (!/[們们]/.test(win[m.index + 1] ?? '') && !/[自忘無无本]/.test(win[m.index - 1] ?? ''))),
  )
  if (!hits.length) return null
  const m = side === 'before' ? hits[hits.length - 1] : hits[0]
  return { name: m[0], index: m.index }
}

function analyze(win: string, side: 'before' | 'after', ctx: ParseContext): Attribution | null {
  if (!win.trim()) return null
  const kind = classify(win)
  const hit = findName(win, side, ctx)
  if (kind) return { kind, speaker: hit?.name ?? null, viaVerb: true }
  if (!hit || hit.name === '我') return null
  // 只有人名、沒有動詞:前置須以冒號收尾;後置須人名開頭(XX微微一笑:「…」/「…」XX微微一笑。)
  if (side === 'before' ? /[：:]\s*$/.test(win) : /^[\s，,、]*$/.test(win.slice(0, hit.index))) {
    return { kind: 'speech', speaker: hit.name, viaVerb: false }
  }
  return null
}

export function isShoutText(text: string): boolean {
  return /[！!][！!？?]+|[？?][！!]+/.test(text) || /\b[A-Z]{4,}\b/.test(text)
}

function stripTrailingPronoun(s: string): string {
  return s.replace(/[他她它牠祂，,、\s]+$/u, '')
}

const narrationType = (text: string): MsgType => (text.length > 40 ? 'narration_long' : 'narration_short')

/** 無引號文字:切句找內心想法,其餘合併為旁白。 */
function narrate(text: string, ctx: ParseContext): Raw[] {
  const out: Raw[] = []
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t && /[\p{L}\p{N}]/u.test(t)) out.push({ type: narrationType(t), speaker: null, text: t })
    buf = ''
  }
  const sentences = text.match(/[^。！？!?…]+[。！？!?…]*/g) ?? [text]
  for (const s of sentences) {
    const m = ctx.thoughtRe.exec(s) ?? ctx.weakThoughtRe.exec(s)
    if (!m) {
      buf += s
      continue
    }
    const pre = stripTrailingPronoun(s.slice(0, m.index))
    buf += pre
    flush()
    const who = m[1] && ctx.names.includes(m[1]) ? m[1] : null
    out.push({ type: 'thought', speaker: who, text: m[3].trim(), quote: true, explicit: !!who })
  }
  flush()
  return out
}

export const IMG_MARK = /^⟦img:(.+)⟧$/
const WHOLE_PAREN = /^[（(]([^（）()]{2,}.*?)[）)]$/
const WHOLE_TELEPATHY = /^『(.{1,}?)』$/
/** 像技能名/專有名詞的短引號:無標點、很短 */
const isTermLike = (t: string, open?: string) => t.length <= (open === '『' ? 40 : 10) && !/[，,。！？!?…、～─—:：]/.test(t)

const ATTR_LEN = MAX_CONSUMED_LEN

interface Attributed {
  quoteMsgs: Map<number, Raw>
  consumed: Set<number>
  terms: Set<number>
}

function attribute(segs: Seg[], ctx: ParseContext): Attributed {
  const consumed = new Set<number>()
  const quoteMsgs = new Map<number, Raw>()
  const terms = new Set<number>()
  const otherTextLen = segs.filter((s) => s.kind === 'text').reduce((n, s) => n + s.text.trim().length, 0)

  segs.forEach((seg, i) => {
    if (seg.kind !== 'quote') return
    const before = segs[i - 1]?.kind === 'text' ? segs[i - 1].text : ''
    const after = segs[i + 1]?.kind === 'text' ? segs[i + 1].text : ''
    const bAttr = analyze(before.slice(-WINDOW), 'before', ctx)
    const aAttr = analyze(after.slice(0, WINDOW), 'after', ctx)
    const colonLead = /[：:]\s*$/.test(before)

    // 前置型優先,其次後置型;沒有前一則引號時前置無條件優先
    let attr: Attribution | null = null
    let from: 'before' | 'after' | null = null
    if (bAttr && (colonLead || !aAttr || segs[i - 2] === undefined)) [attr, from] = [bAttr, 'before']
    else if (aAttr) [attr, from] = [aAttr, 'after']
    else if (bAttr) [attr, from] = [bAttr, 'before']

    // 夾在敘述中的短詞(「赤焰龍」『轉移』):不是台詞,還原成一般文字
    const namingLead = /(?:是|為|为|叫|稱作|称作|名為|名为|叫做|稱為|称为)$/.test(before.trim())
    if (isTermLike(seg.text, seg.open) && !attr?.viaVerb && (otherTextLen >= 6 || namingLead)) {
      terms.add(i)
      return
    }

    if (from) {
      const idx = from === 'before' ? i - 1 : i + 1
      if (segs[idx].text.trim().length <= ATTR_LEN) consumed.add(idx)
    }

    let type: MsgType
    if (attr?.kind === 'thought') type = 'thought'
    else if (attr?.kind === 'shout' || isShoutText(seg.text)) type = 'shout'
    else type = attr ? 'dialog' : 'unknown'
    quoteMsgs.set(i, { type, speaker: attr?.speaker ?? null, text: seg.text, quote: true, explicit: !!attr?.speaker })
  })
  return { quoteMsgs, consumed, terms }
}

/**
 * 同一段被引號/想法切開的旁白,樣式要一致:
 * 用「整段旁白的總字數」決定是置中小字(短)還是整幅卡片(長),而不是各自判斷。
 */
function unifyNarration(msgs: Raw[]): Raw[] {
  const pieces = msgs.filter((m) => isNarr(m) && !m.scene)
  if (pieces.length < 2) return msgs
  const type = narrationType(pieces.map((m) => m.text).join(''))
  return msgs.map((m) => (isNarr(m) && !m.scene ? { ...m, type } : m))
}

function parseParagraph(para: string, ctx: ParseContext): Raw[] {
  return unifyNarration(parseParagraphRaw(para, ctx))
}

function parseParagraphRaw(para: string, ctx: ParseContext): Raw[] {
  const img = IMG_MARK.exec(para)
  if (img) return [{ type: 'image', speaker: null, text: img[1] }]
  if (SCENE_BREAK.test(para)) return [{ type: 'narration_short', speaker: null, text: para.replace(/\s+/g, ' '), scene: true }]

  // 整段是（…）:內心獨白;整段是『…』:念話/傳音(視為對話)
  const paren = WHOLE_PAREN.exec(para)
  if (paren) return [{ type: 'thought', speaker: null, text: paren[1].trim(), quote: true }]
  const tele = WHOLE_TELEPATHY.exec(para)
  if (tele && !tele[1].includes('』')) {
    return [{ type: isShoutText(tele[1]) ? 'shout' : 'unknown', speaker: null, text: tele[1].trim(), quote: true }]
  }

  let segs = tokenize(para)
  if (!segs.some((s) => s.kind === 'quote')) return narrate(para, ctx)

  let res = attribute(segs, ctx)
  if (res.terms.size) {
    // 把詞彙型引號併回文字,再重新分析
    const merged: Seg[] = []
    segs.forEach((seg, i) => {
      const piece: Seg = res.terms.has(i) ? { kind: 'text', text: `${seg.open}${seg.text}${seg.close}` } : seg
      const last = merged[merged.length - 1]
      if (piece.kind === 'text' && last?.kind === 'text') last.text += piece.text
      else merged.push({ ...piece })
    })
    segs = merged
    if (!segs.some((s) => s.kind === 'quote')) return narrate(segs.map((s) => s.text).join(''), ctx)
    res = attribute(segs, ctx)
  }

  const out: Raw[] = []
  segs.forEach((seg, i) => {
    if (seg.kind === 'quote') out.push(res.quoteMsgs.get(i)!)
    else if (!res.consumed.has(i)) out.push(...narrate(seg.text, ctx))
  })
  return out
}

const MAX_MERGED_NARRATION = 600
const isNarr = (m: Raw) => m.type === 'narration_short' || m.type === 'narration_long'

/** 連續的旁白段落合併成一則,避免一段情境被切成一堆小訊息。 */
function mergeNarration(msgs: Raw[]): Raw[] {
  const out: Raw[] = []
  for (const m of msgs) {
    const last = out[out.length - 1]
    if (last && isNarr(last) && isNarr(m) && !last.scene && !m.scene && last.text.length + m.text.length <= MAX_MERGED_NARRATION) {
      const text = `${last.text}\n${m.text}`
      out[out.length - 1] = { ...last, text, type: narrationType(text) }
    } else out.push(m)
  }
  return out
}

// ---- 說話者推測 ----

const EXTRA_SAY = ['言', '斷言', '訴說', '宣告', '宣言', '宣稱', '呢喃', '嘀咕', '嘟囔', '表示', '詢問', '提問', '回應', '低聲', '輕聲', '斥責', '喝止', '怒斥', '吐槽', '補充', '催促']

/**
 * 「台詞」之後單獨成段的敘述若以人名開頭並帶說話動詞(「巴爾薩怒吼道。」),
 * 就是前一句台詞的標註:補上說話者,並把這句純標註拿掉。
 */
function attributeFromNarration(msgs: Raw[], ctx: ParseContext): Raw[] {
  if (!ctx.names.length) return msgs
  const re = new RegExp(`^(${alt(ctx.names)})[^，,。！？!?、：:「『（]{0,14}?(${alt([...SHOUT_VERBS, ...SPEECH_VERBS, ...EXTRA_SAY])})`)
  const shoutRe = new RegExp(`(${alt(SHOUT_VERBS)})`)
  const out: Raw[] = []
  for (const m of msgs) {
    const prev = out[out.length - 1]
    if (!prev?.quote || prev.explicit || prev.type === 'thought' || !isNarr(m) || m.scene) {
      out.push(m)
      continue
    }
    const first = /^[^。！？!?\n]*[。！？!?]?/.exec(m.text)![0]
    const hit = re.exec(first)
    if (!hit) {
      out.push(m)
      continue
    }
    prev.speaker = hit[1]
    prev.explicit = true
    prev.guess = false
    if (prev.type === 'unknown') prev.type = 'dialog'
    if (shoutRe.test(first)) prev.type = 'shout'
    if (first.length <= 24) {
      const rest = m.text.slice(first.length).replace(/^\n+/, '')
      if (!rest) continue
      out.push({ ...m, text: rest, type: narrationType(rest) })
    } else out.push(m)
  }
  return out
}

/** 依出現順序列出文字中的角色名,並標出是否位於子句開頭(較可能是主詞) */
function namesIn(text: string, ctx: ParseContext): { name: string; clauseStart: boolean }[] {
  const found = ctx.inferRe
    ? [...text.matchAll(ctx.inferRe)].map((m) => ({
        name: m[0],
        clauseStart: m.index === 0 || /[，,。！？、：:；\s]/.test(text[m.index - 1]),
      }))
    : []
  // 第一人稱敘事:以「我」開頭的旁白,主詞多半是「我」(把握較低,clauseStart 不算)
  if (ctx.firstPerson && /^我(?![們们])/.test(text)) found.unshift({ name: '我', clauseStart: false })
  return found
}

const HONORIFIC_TAIL = /^(?:兄弟|大人|殿下|閣下|先生|小姐|陛下|騎士|老師|同學|大哥|姐姐|哥哥)?$/

/** 台詞開頭在稱呼誰(「青葉兄弟,…」「太陽,你…」)——被稱呼的人不會是說話者 */
function vocativeNames(text: string, ctx: ParseContext): Set<string> {
  const out = new Set<string>()
  const clause = /^[^，,、！？。!?…]{1,10}/.exec(text)?.[0]
  if (!clause || clause.length === text.length) return out
  for (const n of ctx.names) {
    for (const form of n.length >= 3 ? [n, n.slice(0, 2)] : [n]) {
      if (clause.startsWith(form) && HONORIFIC_TAIL.test(clause.slice(form.length))) out.add(n)
    }
  }
  return out
}

const RECENT_LIMIT = 6
const front = (list: string[], name: string) => [name, ...list.filter((n) => n !== name)].slice(0, RECENT_LIMIT)

/**
 * 日系/翻譯小說的對話常常完全沒有標註。這裡用兩個簡單規則推測:
 * 1. 連續對話 → 兩人輪流說(找最近出現過、且不是上一位說話者的角色)
 * 2. 旁白之後的第一句 → 旁白裡的主詞(沒有就用最近的視角人物)
 * 推測出來的說話者會標 guess;其中把握較低的再標 weak(畫面上才顯示「?」):
 * 旁白主詞不在子句開頭、只能用最近視角人物、或輪流推測連續超過兩次。
 */
function inferSpeakers(msgs: Raw[], ctx: ParseContext): void {
  let last: string | null = null
  let pov: string | null = null
  let recent: string[] = []
  let prevWasQuote = false
  let narrSubject: string | null = null
  let subjectStrong = false
  let povScore = new Map<string, number>()
  let lastStrong = true
  let depth = 0

  for (const m of msgs) {
    if (m.scene) {
      last = pov = narrSubject = null
      povScore = new Map()
      lastStrong = true
      depth = 0
      recent = []
      prevWasQuote = false
      continue
    }
    if (!m.quote) {
      const names = namesIn(m.text, ctx)
      if (names.length) {
        const subj = names.find((n) => n.clauseStart)
        narrSubject = (subj ?? names[0]).name
        subjectStrong = !!subj
        // 視角人物:最近幾段旁白裡最常當主詞的人(逐段衰減)
        for (const [k, v] of povScore) povScore.set(k, v * 0.85)
        for (const n of names) povScore.set(n.name, (povScore.get(n.name) ?? 0) + (n.clauseStart ? 1 : 0.3))
        pov = narrSubject
        for (const n of [...names].reverse()) recent = front(recent, n.name)
      }
      prevWasQuote = false
      continue
    }

    if (m.speaker && m.explicit) {
      last = m.speaker
      lastStrong = true
      depth = 0
      recent = front(recent, m.speaker)
    } else if (!m.speaker) {
      let cand: string | null = null
      let strong = false
      const voc = m.type === 'thought' ? new Set<string>() : vocativeNames(m.text, ctx)
      if (m.type === 'thought') {
        // 內心獨白多半屬於這段時間的視角人物,而不只是上一段旁白剛好提到的人
        const top = [...povScore].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        cand = top ?? narrSubject ?? pov
        strong = cand !== null && cand === narrSubject && subjectStrong
      } else if (prevWasQuote && last) {
        cand = recent.find((n) => n !== last && !voc.has(n)) ?? null
        depth++
        strong = lastStrong && depth <= 2
      } else {
        cand = narrSubject ?? pov
        strong = narrSubject !== null && subjectStrong
        depth = 0
      }
      // 被稱呼的人不會是說話者:改選最近出現過的其他角色,把握降低
      if (cand && voc.has(cand)) {
        cand = recent.find((n) => n !== cand && !voc.has(n)) ?? (ctx.firstPerson ? '我' : null)
        strong = false
      }
      if (cand) {
        m.speaker = cand
        m.guess = true
        m.weak = !strong
        if (m.type === 'unknown') m.type = 'dialog'
      }
      if (m.type !== 'thought' && m.speaker) {
        last = m.speaker
        lastStrong = strong
        recent = front(recent, m.speaker)
      }
    } else if (m.type !== 'thought') {
      last = m.speaker
      lastStrong = !(m.guess && m.weak)
      depth = 0
      recent = front(recent, m.speaker)
    }
    // 稱呼對象(「米蘭,過來」)很可能是下一位說話者
    const vocative = m.type !== 'thought' && ctx.inferRe ? new RegExp(`^(${ctx.names.length ? alt(ctx.names) : '(?!)'})[，,、]`).exec(m.text) : null
    if (vocative && vocative[1] !== last) recent = front(recent, vocative[1])
    narrSubject = null
    subjectStrong = false
    prevWasQuote = m.type !== 'thought'
  }
}

/** 單段旁白若以學到的符號開頭,改成對應類型(例如「──」開頭的內心獨白) */
function applyTypeRules(msgs: Raw[], ctx: ParseContext): Raw[] {
  if (!ctx.typeRules.length) return msgs
  return msgs.map((m) => {
    if (!isNarr(m) || m.scene) return m
    const rule = ctx.typeRules.find((r) => m.text.startsWith(r.prefix))
    if (!rule) return m
    return { ...m, type: rule.type, text: m.text.slice(rule.prefix.length).trim() || m.text, quote: true }
  })
}

/** 取出開頭的標記符號(──、※、＊ 等)作為規則前綴;沒有則回傳 null */
export function rulePrefix(text: string): string | null {
  return /^[─—―＊※●◆◇・…]{1,3}/.exec(text)?.[0] ?? null
}

/**
 * 把規則套用到「已解析」的章節:旁白訊息中以該符號開頭的行,拆出來改成指定類型。
 * 回傳新的訊息陣列(id 會重編)。
 */
export function applyRuleToMessages(msgs: Message[], rule: TypeRule, chapterIndex: number, ctx: ParseContext): Message[] {
  const out: Message[] = []
  for (const m of msgs) {
    if (m.edited || (m.type !== 'narration_short' && m.type !== 'narration_long')) {
      out.push(m)
      continue
    }
    let buf: string[] = []
    const flush = () => {
      if (!buf.length) return
      const text = buf.join('\n')
      out.push({ ...m, text, type: narrationType(text), id: '' })
      buf = []
    }
    for (const line of m.text.split('\n')) {
      if (line.startsWith(rule.prefix)) {
        flush()
        out.push({ ...m, type: rule.type, text: line.slice(rule.prefix.length).trim() || line, speaker: null, id: '' })
      } else buf.push(line)
    }
    flush()
  }
  const renumbered = out.map((m, i) => ({ ...m, id: `${chapterIndex}-${i}` }))
  reinferFrom(renumbered, ctx, -1)
  return renumbered
}

/** 把使用者修正過的訊息當作定錨,重新推測後面「推測出來」的說話者。回傳有變動的則數。 */
export function reinferFrom(msgs: Message[], ctx: ParseContext, from: number): number {
  const before = msgs.map((m) => m.speaker)
  const raws: Raw[] = msgs.map((m, i) => {
    const centered = m.type === 'narration_short' || m.type === 'narration_long' || m.type === 'image'
    if (i > from && m.guess && !m.edited) return { ...m, speaker: null, guess: undefined, weak: undefined, quote: !centered, scene: centered && SCENE_BREAK.test(m.text) }
    return { ...m, quote: !centered, explicit: m.speaker !== null && !m.guess, scene: centered && SCENE_BREAK.test(m.text) }
  })
  inferSpeakers(raws, ctx)
  let changed = 0
  raws.forEach((r, i) => {
    if (i <= from || msgs[i].edited) return
    msgs[i].speaker = r.speaker
    msgs[i].guess = r.guess
    msgs[i].weak = r.weak
    msgs[i].type = r.type
    if (before[i] !== r.speaker) changed++
  })
  return changed
}

export function parseChapter(text: string, chapterIndex: number, ctx: ParseContext): Message[] {
  const raw: Raw[] = []
  for (const para of toParagraphs(text)) raw.push(...applyTypeRules(parseParagraph(para, ctx), ctx))
  const merged = attributeFromNarration(mergeNarration(raw), ctx)
  inferSpeakers(merged, ctx)
  return merged.map(({ quote: _q, explicit: _e, scene: _s, ...m }, i) => ({
    ...m,
    speaker: m.speaker !== null ? (ctx.aliases[m.speaker] ?? m.speaker) : null,
    id: `${chapterIndex}-${i}`,
  }))
}
