import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { exportBook } from '../lib/library'
import { applyRuleToMessages, createContext, parseChapter, reinferFrom, rulePrefix } from '../lib/parser'
import { getChapter, putChapter, putMeta } from '../lib/storage'
import type { BookMeta, ChapterData, Message, TypeRule } from '../lib/types'
import Bubble, { TypingIndicator } from './Bubble'
import FixSheet from './FixSheet'

const TYPING_DELAY_MS = 450
const isNarration = (m: Message) => m.type === 'narration_short' || m.type === 'narration_long' || m.type === 'image'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function loadFontSize(): number {
  try {
    return Number(localStorage.getItem('fontSize')) || 16
  } catch {
    return 16
  }
}

export default function Reader({ initial, onBack }: { initial: BookMeta; onBack: () => void }) {
  const [meta, setMeta] = useState(initial)
  const metaRef = useRef(initial)
  const [idx, setIdx] = useState(initial.progress.chapter)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [fixId, setFixId] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [fontSize, setFontSize] = useState(loadFontSize)
  const scroller = useRef<HTMLDivElement>(null)
  const chapterText = useRef('')
  const restore = useRef(true)
  /** 剛載入章節才需要重設捲動位置;修正訊息造成的更新不能動到捲動 */
  const needScroll = useRef(true)
  const scrollTimer = useRef<number>(0)

  const ctxRef = useRef(createContext(meta.characters, meta.typeRules, meta.firstPerson))
  useEffect(() => void (ctxRef.current = createContext(meta.characters, meta.typeRules, meta.firstPerson)), [meta.characters, meta.typeRules, meta.firstPerson])

  const showToast = (text: string) => {
    setToast(text)
    setTimeout(() => setToast(''), 3500)
  }

  const updateMeta = useCallback((fn: (m: BookMeta) => BookMeta, render = true) => {
    const next = fn(metaRef.current)
    metaRef.current = next
    if (render) setMeta(next)
    void putMeta(next)
  }, [])

  const ensureParsed = useCallback(async (i: number, delay = 0): Promise<ChapterData> => {
    let data = (await getChapter(metaRef.current.id, i)) ?? { text: '' }
    if (!data.messages) {
      if (delay) await sleep(delay)
      data = { ...data, messages: parseChapter(data.text, i, ctxRef.current) }
      await putChapter(metaRef.current.id, i, data)
    }
    return data
  }, [])

  // 讀當前章節;背景預先解析下一章
  useEffect(() => {
    let cancelled = false
    setMessages(null)
    needScroll.current = true
    void (async () => {
      const data = await ensureParsed(idx, TYPING_DELAY_MS)
      if (cancelled) return
      chapterText.current = data.text
      setMessages(data.messages!)
      if (idx + 1 < metaRef.current.chapterTitles.length) setTimeout(() => void ensureParsed(idx + 1), 200)
    })()
    return () => {
      cancelled = true
    }
  }, [idx, ensureParsed])

  useLayoutEffect(() => {
    if (!messages || !scroller.current || !needScroll.current) return
    scroller.current.scrollTop = restore.current ? metaRef.current.progress.scroll : 0
    restore.current = false
    needScroll.current = false
  }, [messages])

  const goto = (i: number) => {
    if (i < 0 || i >= meta.chapterTitles.length) return
    updateMeta((m) => ({ ...m, progress: { chapter: i, scroll: 0 } }), false)
    setIdx(i)
    setTocOpen(false)
  }

  const onScroll = () => {
    clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const scroll = scroller.current?.scrollTop ?? 0
      updateMeta((m) => ({ ...m, progress: { chapter: idx, scroll } }), false)
    }, 600)
  }

  const fixing = messages?.find((m) => m.id === fixId) ?? null

  const applyFix = (patch: Partial<Pick<Message, 'type' | 'speaker' | 'guess'>>) => {
    if (!messages || !fixing) return
    const updated: Message = { ...fixing, ...patch, edited: true }
    if (isNarration(updated)) updated.speaker = null
    let next = messages.map((m) => (m.id === fixing.id ? updated : m))
    const notes: string[] = []

    // 學習 1:說話者改了 → 以此為基準,重新推測同章後面「猜的」訊息
    const fixedAt = next.findIndex((m) => m.id === fixing.id)
    if (patch.speaker !== undefined && !isNarration(updated)) {
      next = next.map((m) => ({ ...m }))
      const changed = reinferFrom(next, ctxRef.current, fixedAt)
      if (changed) notes.push(`已依此重新推測後面 ${changed} 則的說話者`)
    }

    // 學習 2:旁白被改成別種訊息 → 記住它的開頭符號,之後同樣開頭的都套用
    let rule: TypeRule | null = null
    const prefix = rulePrefix(fixing.text)
    if (patch.type && isNarration(fixing) && !isNarration(updated) && prefix) {
      rule = { prefix, type: patch.type }
      next = applyRuleToMessages(next, rule, idx, ctxRef.current)
      notes.push(`已學會:「${prefix}」開頭的旁白都當作${patch.type === 'thought' ? '內心想法' : '此類型'}`)
    }

    setMessages(next)
    void putChapter(meta.id, idx, { text: chapterText.current, messages: next })
    updateMeta((m) => ({
      ...m,
      characters: updated.speaker && !m.characters.includes(updated.speaker) ? [...m.characters, updated.speaker] : m.characters,
      typeRules: rule ? [...(m.typeRules ?? []).filter((r) => r.prefix !== rule!.prefix), rule] : m.typeRules,
      corrections: [
        ...m.corrections,
        {
          chapter: idx,
          messageId: fixing.id,
          text: fixing.text,
          from: { type: fixing.type, speaker: fixing.speaker },
          to: { type: updated.type, speaker: updated.speaker },
          at: Date.now(),
        },
      ],
    }))
    if (notes.length) showToast(notes.join(';'))
    if (rule) setFixId(null)
  }

  const changeFont = (d: number) => {
    const n = Math.min(26, Math.max(12, fontSize + d))
    setFontSize(n)
    try {
      localStorage.setItem('fontSize', String(n))
    } catch {
      /* ignore */
    }
  }

  const typingName = useMemo(() => meta.characters.find((c) => c !== meta.me) ?? meta.characters[0] ?? '對方', [meta])

  return (
    <div className="page reader" style={{ ['--fs' as string]: `${fontSize}px` }}>
      <header>
        <button className="icon-btn" onClick={onBack} aria-label="返回">‹</button>
        <div className="titles">
          <b>{meta.title}</b>
          <span>{meta.chapterTitles[idx]}</span>
        </div>
        <button className="icon-btn" onClick={() => changeFont(-1)} aria-label="縮小字體">A−</button>
        <button className="icon-btn" onClick={() => changeFont(1)} aria-label="放大字體">A+</button>
        <button className="icon-btn" onClick={() => setTocOpen(true)} aria-label="目錄">☰</button>
        <button className="icon-btn" onClick={() => void exportBook(meta)} aria-label="匯出解析檔">⤓</button>
      </header>

      <div className="chat" ref={scroller} onScroll={onScroll}>
        {messages === null ? (
          <TypingIndicator name={typingName} />
        ) : (
          <>
            <div className="row center">
              <span className="sys">{meta.chapterTitles[idx]}</span>
            </div>
            {messages.map((m) => {
              const right = !isNarration(m) && m.speaker !== null && m.speaker === meta.me
              return <Bubble key={m.id} bookId={meta.id} msg={m} right={right} onLongPress={(x) => x.type !== 'image' && setFixId(x.id)} />
            })}
            <div className="chapter-nav">
              <button disabled={idx === 0} onClick={() => goto(idx - 1)}>上一章</button>
              <button disabled={idx + 1 >= meta.chapterTitles.length} onClick={() => goto(idx + 1)}>下一章</button>
            </div>
            <p className="hint">長按任一則訊息可修正角色或類型</p>
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {fixing && (
        <FixSheet
          msg={fixing}
          characters={meta.characters}
          me={meta.me}
          onChange={applyFix}
          onSetMe={(name) => updateMeta((m) => ({ ...m, me: name }))}
          onClose={() => setFixId(null)}
        />
      )}

      {tocOpen && (
        <div className="sheet-backdrop" onClick={() => setTocOpen(false)}>
          <div className="sheet toc" onClick={(e) => e.stopPropagation()}>
            <h3>目錄</h3>
            <ul>
              {meta.chapterTitles.map((t, i) => (
                <li key={i}>
                  <button className={i === idx ? 'on' : ''} onClick={() => goto(i)}>{t}</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
