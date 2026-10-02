import { useEffect, useRef, useState } from 'react'
import { BURST_AMP, burstPoints } from '../lib/burst'
import { getImage } from '../lib/storage'
import { avatarColor, avatarLetter } from '../lib/color'
import type { Message } from '../lib/types'

interface Props {
  bookId: string
  msg: Message
  right: boolean
  onLongPress: (m: Message) => void
}

const LONG_PRESS_MS = 500

function useLongPress(cb: () => void) {
  const timer = useRef<number>(0)
  const start = useRef({ x: 0, y: 0 })
  const cancel = () => clearTimeout(timer.current)
  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(cb, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => (e.preventDefault(), cancel(), cb()),
  }
}

function Illustration({ bookId, path }: { bookId: string; path: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let u: string | undefined
    let alive = true
    void getImage(bookId, path).then((b) => {
      if (b && alive) setUrl((u = URL.createObjectURL(b)))
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [bookId, path])
  return url ? <img className="illust" src={url} alt="插圖" /> : <div className="illust ph" />
}

/** 漫畫爆炸框:依氣泡實際大小動態畫刺,放在文字後面 */
function ShoutBubble({ msg }: { msg: Message }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="bubble shout" ref={box}>
      {size && (
        <svg
          className="burst"
          width={size.w + BURST_AMP * 2}
          height={size.h + BURST_AMP * 2}
          style={{ left: -BURST_AMP, top: -BURST_AMP }}
          aria-hidden
        >
          <polygon points={burstPoints(size.w, size.h, msg.id)} />
        </svg>
      )}
      <span className="shout-text">{msg.text}</span>
    </div>
  )
}

export default function Bubble({ bookId, msg, right, onLongPress }: Props) {
  const press = useLongPress(() => onLongPress(msg))
  const edited = msg.edited ? <i className="edited" title="已修正" /> : null

  if (msg.type === 'image')
    return (
      <div className="row full">
        <Illustration bookId={bookId} path={msg.text} />
      </div>
    )
  if (msg.type === 'narration_short')
    return (
      <div className="row center" {...press}>
        <span className="sys">{msg.text}</span>
        {edited}
      </div>
    )
  if (msg.type === 'narration_long')
    return (
      <div className="row full" {...press}>
        <div className="card">{msg.text}</div>
      </div>
    )

  const name = (msg.speaker ?? '未知角色') + (msg.guess ? ' ?' : '')
  return (
    <div className={`row head ${right ? 'right' : 'left'}`} {...press}>
      {!right && <Avatar name={msg.speaker} />}
      <div className="col">
        <div className="name">{name}</div>
        {msg.type === 'shout' ? (
          <ShoutBubble msg={msg} />
        ) : (
          <div className={`bubble ${msg.type}`}>
            {msg.type === 'unknown' && <span className="tag">待確認</span>}
            {msg.text}
          </div>
        )}
      </div>
      {right && <Avatar name={msg.speaker} />}
      {edited}
    </div>
  )
}

const Avatar = ({ name }: { name: string | null }) => (
  <div className="avatar" style={{ background: avatarColor(name) }}>
    {avatarLetter(name)}
  </div>
)

export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="row left head">
      <div className="avatar" style={{ background: avatarColor(name) }}>
        {avatarLetter(name)}
      </div>
      <div className="col">
        <div className="name">{name}</div>
        <div className="bubble dialog typing" aria-label={`${name}正在輸入中`}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}
