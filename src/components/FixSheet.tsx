import { useMemo, useState } from 'react'
import { avatarColor, avatarLetter } from '../lib/color'
import { splitSegments } from '../lib/segments'
import type { Message, MsgType } from '../lib/types'

interface Props {
  msg: Message
  characters: string[]
  me: string | null
  onChange: (patch: Partial<Pick<Message, 'type' | 'speaker' | 'guess'>>) => void
  onSetMe: (name: string) => void
  onClose: () => void
  onManage: () => void
  /** 上一則也是旁白時,可合併成同一段 */
  canMergePrev: boolean
  onMergePrev: () => void
  /** 把旁白中選取的一段(字元範圍)拆出來,變成指定類型/角色 */
  onSplit: (start: number, end: number, type: MsgType, speaker: string | null) => void
}

const TYPES: { label: string; type: MsgType }[] = [
  { label: '一般對話', type: 'dialog' },
  { label: '內心想法', type: 'thought' },
  { label: '大喊', type: 'shout' },
  { label: '旁白(段落)', type: 'narration_long' },
  { label: '旁白(短句)', type: 'narration_short' },
]

export default function FixSheet({ msg, characters, me, onChange, onSetMe, onClose, onManage, canMergePrev, onMergePrev, onSplit }: Props) {
  const [newName, setNewName] = useState('')
  const [anchor, setAnchor] = useState<number | null>(null)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [selType, setSelType] = useState<MsgType>('dialog')
  const [selSpeaker, setSelSpeaker] = useState<string | null>(null)
  const [selNew, setSelNew] = useState('')
  const isNarration = msg.type === 'narration_short' || msg.type === 'narration_long'
  const pickType = (type: MsgType) => onChange({ type })
  const segments = useMemo(() => (isNarration ? splitSegments(msg.text) : []), [isNarration, msg.text])

  const tapSegment = (i: number) => {
    if (anchor === null || sel === null) {
      setAnchor(i)
      setSel([i, i])
    } else if (sel[0] === sel[1] && sel[0] === i) {
      setAnchor(null)
      setSel(null)
    } else {
      setSel([Math.min(anchor, i), Math.max(anchor, i)])
    }
  }

  const isNarrationTarget = selType === 'narration_short'
  const applySplit = () => {
    if (!sel) return
    const typed = selNew.trim()
    onSplit(segments[sel[0]].start, segments[sel[1]].end, selType, isNarrationTarget ? null : typed || selSpeaker)
  }

  const addCharacter = () => {
    const n = newName.trim()
    if (n) (onChange({ speaker: n, guess: false, type: isNarration ? 'dialog' : msg.type }), setNewName(''))
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-quote">{msg.text.length > 60 ? msg.text.slice(0, 60) + '…' : msg.text}</div>

        <h3>訊息類型</h3>
        <div className="chips">
          {TYPES.map((t) => (
            <button key={t.type} className={`chip ${msg.type === t.type ? 'on' : ''}`} onClick={() => pickType(t.type)}>
              {t.label}
            </button>
          ))}
        </div>

        {isNarration && segments.length > 0 && (
          <>
            <h3>拆出其中的句子{segments.length > 1 ? '(點選句子,可連續選多句)' : ''}</h3>
            <div className="segs">
              {segments.map((s, i) => (
                <button key={s.start} className={`seg ${sel && i >= sel[0] && i <= sel[1] ? 'on' : ''}`} onClick={() => tapSegment(i)}>
                  {s.text}
                </button>
              ))}
            </div>
            {sel && (
              <div className="split-panel">
                <h3>選取的句子變成</h3>
                <div className="chips">
                  {TYPES.filter((t) => t.type !== 'narration_long').map((t) => (
                    <button key={t.type} className={`chip ${selType === t.type ? 'on' : ''}`} onClick={() => setSelType(t.type)}>
                      {t.type === 'narration_short' ? '獨立一行短句' : t.label}
                    </button>
                  ))}
                </div>
                {!isNarrationTarget && (
                  <>
                    <h3>誰說的</h3>
                    <div className="chips">
                      <button className={`chip ${selSpeaker === null && !selNew.trim() ? 'on' : ''}`} onClick={() => (setSelSpeaker(null), setSelNew(''))}>
                        未知
                      </button>
                      {characters.map((c) => (
                        <button key={c} className={`chip ${selSpeaker === c && !selNew.trim() ? 'on' : ''}`} onClick={() => (setSelSpeaker(c), setSelNew(''))}>
                          <span className="dot" style={{ background: avatarColor(c) }}>
                            {avatarLetter(c)}
                          </span>
                          {c}
                        </button>
                      ))}
                    </div>
                    <div className="add">
                      <input value={selNew} placeholder="或輸入新角色名…" onChange={(e) => setSelNew(e.target.value)} />
                    </div>
                  </>
                )}
                <button className="done" onClick={applySplit}>套用拆分</button>
              </div>
            )}
          </>
        )}

        {isNarration && canMergePrev && (
          <button className="link" onClick={onMergePrev}>與上一則旁白合併成同一段</button>
        )}

        {!isNarration && (
          <>
            <h3>說話者</h3>
            <div className="chips">
              <button className={`chip ${msg.speaker === null ? 'on' : ''}`} onClick={() => onChange({ speaker: null, guess: false })}>
                未知
              </button>
              {characters.map((c) => (
                <button key={c} className={`chip ${msg.speaker === c ? 'on' : ''}`} onClick={() => onChange({ speaker: c, guess: false })}>
                  <span className="dot" style={{ background: avatarColor(c) }}>
                    {avatarLetter(c)}
                  </span>
                  {c}
                </button>
              ))}
            </div>
            <div className="add">
              <input
                value={newName}
                placeholder="新增角色…"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCharacter()}
              />
              <button onClick={addCharacter}>新增</button>
            </div>
            <button className="link" onClick={onManage}>管理角色(改名/刪除)</button>
            {msg.speaker && msg.speaker !== me && (
              <button className="link" onClick={() => onSetMe(msg.speaker!)}>
                以「{msg.speaker}」為主視角(訊息靠右)
              </button>
            )}
          </>
        )}
        <button className="done" onClick={onClose}>完成</button>
      </div>
    </div>
  )
}
