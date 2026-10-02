import { useState } from 'react'
import { avatarColor, avatarLetter } from '../lib/color'

interface Props {
  characters: string[]
  me: string | null
  onRename: (from: string, to: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onClose: () => void
}

export default function CharacterSheet({ characters, me, onRename, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const start = (name: string) => {
    setEditing(name)
    setDraft(name)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  const save = (from: string) => {
    const to = draft.trim()
    if (!to || to === from) return setEditing(null)
    if (characters.includes(to) && !confirm(`「${to}」已經存在。\n要把「${from}」的所有訊息合併進「${to}」嗎?(合併後無法分開)`)) return
    void run(() => onRename(from, to))
  }

  const remove = (name: string) => {
    if (confirm(`刪除角色「${name}」?\n它的所有訊息會變成「未知角色」,之後也不會再被辨識出來。`)) void run(() => onDelete(name))
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>角色管理({characters.length})</h3>
        <p className="muted">改名或刪除會套用到整本書。打錯的名字、程式誤抓的雜訊詞,都可以在這裡處理。</p>
        <ul className="char-list">
          {characters.map((c) => (
            <li key={c}>
              <span className="dot" style={{ background: avatarColor(c) }}>
                {avatarLetter(c)}
              </span>
              {editing === c ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => (e.key === 'Enter' ? save(c) : e.key === 'Escape' && setEditing(null))}
                  />
                  <button className="mini ok" disabled={busy} onClick={() => save(c)}>儲存</button>
                  <button className="mini" disabled={busy} onClick={() => setEditing(null)}>取消</button>
                </>
              ) : (
                <>
                  <span className="char-name">
                    {c}
                    {c === me && <em>主視角</em>}
                  </span>
                  <button className="mini" disabled={busy} onClick={() => start(c)}>改名</button>
                  <button className="mini danger" disabled={busy} onClick={() => remove(c)}>刪除</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <button className="done" onClick={onClose}>完成</button>
      </div>
    </div>
  )
}
