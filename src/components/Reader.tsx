import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { exportBook } from '../lib/library'
import { applyRuleToMessages, createContext, mergeAdjacentNarration, parseChapter, reinferFrom, rulePrefix } from '../lib/parser'
import { getChapter, putChapter, putMeta } from '../lib/storage'
import type { BookMeta, ChapterData, Message, MsgType, TypeRule } from '../lib/types'
import Bubble, { TypingIndicator } from './Bubble'
import { deleteCharacter, renameCharacter } from '../lib/characterOps'
import CharacterSheet from './CharacterSheet'
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
  const [charsOpen, setCharsOpen] = useState(false)
  const [fontSize, setFontSize] = useState(loadFontSize)
  const scroller = useRef<HTMLDivElement>(null)
  const chapterText = useRef('')
  const restore = useRef(true)
  /** 剛載入章節才需要重設捲動位置;修正訊息造成的更新不能動到捲動 */
  const needScroll = useRef(true)
  const scrollTimer = useRef<number>(0)

  const ctxRef = useRef(createContext(meta.characters, meta.typeRules, meta.firstPerson, meta.aliases))
  useEffect(() => void (ctxRef.current = createContext(meta.characters, meta.typeRules, meta.firstPerson, meta.aliases)), [meta.characters, meta.typeRules, meta.firstPerson, meta.aliases])

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
      // 連續的旁白併成一塊(舊資料也會被整理並存回)
      const tidy = mergeAdjacentNarration(data.messages!)
      if (tidy !== data.messages) void putChapter(metaRef.current.id, idx, { ...data, messages: tidy })
      setMessages(tidy)
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

    next = mergeAdjacentNarration(next)
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

  /** 角色改名/合併/刪除後:更新 meta,並重新讀取當前章節(不動捲動位置) */
  const afterCharacterOp = async (next: BookMeta, note: string) => {
    metaRef.current = next
    setMeta(next)
    const data = await getChapter(next.id, idx)
    if (data?.messages) setMessages(data.messages)
    showToast(note)
  }

  const renameChar = async (from: string, to: string) => {
    const r = await renameCharacter(metaRef.current, from, to)
    await afterCharacterOp(r.meta, r.merged ? `已把「${from}」合併進「${to.trim()}」(${r.affected} 則)` : `已改名為「${to.trim()}」(${r.affected} 則)`)
  }

  const deleteChar = async (name: string) => {
    const r = await deleteCharacter(metaRef.current, name)
    await afterCharacterOp(r.meta, `已刪除「${name}」(${r.affected} 則變成未知角色)`)
  }

  /** 旁白裡選取的一段 → 拆成獨立訊息(對話/想法/大喊/獨立短句),前後文字仍是旁白 */
  const splitSelection = (start: number, end: number, type: MsgType, speaker: string | null) => {
    if (!messages || !fixing) return
    const i = messages.findIndex((m) => m.id === fixing.id)
    const text = fixing.text
    const before = text.slice(0, start).trim()
    const after = text.slice(end).trim()
    const selected = text.slice(start, end).trim().replace(/^[「『“"]([\s\S]*)[」』”"]$/, '$1').trim()
    if (!selected) return

    const narr = (t: string): Message => ({ id: '', type: t.length > 40 ? 'narration_long' : 'narration_short', speaker: null, text: t })
    const isNarr = type === 'narration_short'
    const picked: Message = { id: '', type, speaker: isNarr ? null : speaker, text: selected, edited: true, guess: false, ...(isNarr ? { solo: true } : {}) }
    const pieces = [...(before ? [narr(before)] : []), picked, ...(after ? [narr(after)] : [])]
    const pickedAt = i + (before ? 1 : 0)
    let next = [...messages.slice(0, i), ...pieces, ...messages.slice(i + 1)].map((m, n) => ({ ...m, id: `${idx}-${n}` }))

    const notes = ['已拆出選取的句子']
    if (!isNarr && speaker) {
      next = next.map((m) => ({ ...m }))
      const changed = reinferFrom(next, ctxRef.current, pickedAt)
      if (changed) notes.push(`並重新推測後面 ${changed} 則`)
    }
    setMessages(next)
    void putChapter(meta.id, idx, { text: chapterText.current, messages: next })
    updateMeta((m) => ({
      ...m,
      characters: !isNarr && speaker && !m.characters.includes(speaker) ? [...m.characters, speaker] : m.characters,
      corrections: [
        ...m.corrections,
        { chapter: idx, messageId: fixing.id, text: selected, from: { type: fixing.type, speaker: null }, to: { type, speaker: picked.speaker }, at: Date.now() },
      ],
    }))
    setFixId(null)
    showToast(notes.join(','))
  }

  /** 把這則旁白併入上一則旁白(同一段被切開時用) */
  const mergeWithPrev = () => {
    if (!messages || !fixing) return
    const i = messages.findIndex((m) => m.id === fixing.id)
    const prev = messages[i - 1]
    if (!prev || !isNarration(prev) || prev.type === 'image') return
    const text = `${prev.text}\n${fixing.text}`
    const merged: Message = { ...prev, text, type: text.length > 40 ? 'narration_long' : 'narration_short', edited: true }
    const next = [...messages.slice(0, i - 1), merged, ...messages.slice(i + 1)]
    setMessages(next)
    void putChapter(meta.id, idx, { text: chapterText.current, messages: next })
    setFixId(null)
    showToast('已合併成同一段旁白')
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
        <button className="icon-btn" onClick={() => setCharsOpen(true)} aria-label="角色管理">角色</button>
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
          onManage={() => (setFixId(null), setCharsOpen(true))}
          canMergePrev={(() => {
            const i = messages!.findIndex((m) => m.id === fixing.id)
            const prev = messages![i - 1]
            return !!prev && isNarration(prev) && prev.type !== 'image'
          })()}
          onMergePrev={mergeWithPrev}
          onSplit={splitSelection}
        />
      )}

      {charsOpen && (
        <CharacterSheet
          characters={meta.characters}
          me={meta.me}
          onRename={renameChar}
          onDelete={deleteChar}
          onClose={() => setCharsOpen(false)}
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
