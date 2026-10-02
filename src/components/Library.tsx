import { useCallback, useEffect, useRef, useState } from 'react'
import { importFile } from '../lib/library'
import { deleteBook, listBooks } from '../lib/storage'
import type { BookMeta } from '../lib/types'

export default function Library({ onOpen }: { onOpen: (b: BookMeta) => void }) {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ text: string; ratio?: number }>({ text: '準備中…' })
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [slow, setSlow] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => listBooks().then(setBooks), [])
  useEffect(() => void refresh(), [refresh])

  const upload = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setError('')
    setSlow(false)
    const slowTimer = setTimeout(() => setSlow(true), 15000)
    try {
      onOpen(await importFile(file, (text, ratio) => setProgress({ text, ratio })))
    } catch (e) {
      console.error('匯入失敗', e)
      setError(e instanceof Error ? e.message : '匯入失敗')
      setBusy(false)
    } finally {
      clearTimeout(slowTimer)
    }
  }

  return (
    <div className="page library">
      <h1>對話型小說閱讀器</h1>
      <p className="sub">把小說變成 LINE 對話</p>

      <div
        className={`drop ${drag ? 'over' : ''}`}
        onClick={() => !busy && input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), upload(e.dataTransfer.files[0]))}
      >
        {busy ? (
          <div className="progress" role="status" aria-live="polite">
            <span className="spinner" />
            <strong>匯入中,請稍候</strong>
            <span>{progress.text}</span>
            {slow && <span className="error">已超過 15 秒。如果進度沒有變化,請重新整理頁面再試,並告訴我卡在哪個階段:「{progress.text}」</span>}
            <div className={`bar ${progress.ratio === undefined ? 'indeterminate' : ''}`}>
              <i style={{ width: `${Math.round((progress.ratio ?? 0) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <>
            <strong>上傳小說</strong>
            <span>點擊或拖曳 .txt / .epub(或先前匯出的 .json)</span>
          </>
        )}
        <input ref={input} type="file" hidden accept=".txt,.epub,.json" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {error && <p className="error">{error}</p>}

      {books.length > 0 && <h2>書庫</h2>}
      <ul className="books">
        {books.map((b) => (
          <li key={b.id}>
            <button className="book" onClick={() => onOpen(b)}>
              <span className="book-title">{b.title}</span>
              <span className="book-sub">
                第 {b.progress.chapter + 1} / {b.chapterTitles.length} 章 · {b.characters.length} 位角色
              </span>
            </button>
            <button
              className="icon-btn"
              aria-label="刪除"
              onClick={async () => {
                if (confirm(`刪除「${b.title}」?`)) (await deleteBook(b), refresh())
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
