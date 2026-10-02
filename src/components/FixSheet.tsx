import { useState } from 'react'
import { avatarColor, avatarLetter } from '../lib/color'
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
}

const TYPES: { label: string; type: MsgType }[] = [
  { label: '一般對話', type: 'dialog' },
  { label: '內心想法', type: 'thought' },
  { label: '大喊', type: 'shout' },
  { label: '旁白(段落)', type: 'narration_long' },
  { label: '旁白(短句)', type: 'narration_short' },
]

export default function FixSheet({ msg, characters, me, onChange, onSetMe, onClose, onManage, canMergePrev, onMergePrev }: Props) {
  const [newName, setNewName] = useState('')
  const isNarration = msg.type === 'narration_short' || msg.type === 'narration_long'
  const pickType = (type: MsgType) => onChange({ type })

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
