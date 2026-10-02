import { describe, expect, it } from 'vitest'
import { mergeAdjacentNarration } from './parser'
import { splitSegments } from './segments'
import type { Message } from './types'

describe('splitSegments', () => {
  const text = '他看著天空。「我一定會回來！」然後轉身離開，沒有回頭……\n風很大'
  const segs = splitSegments(text)

  it('splits by sentence enders and keeps trailing closing quotes', () => {
    expect(segs.map((s) => s.text)).toEqual(['他看著天空。', '「我一定會回來！」', '然後轉身離開，沒有回頭……', '風很大'])
  })
  it('offsets point back into the original text exactly', () => {
    for (const s of segs) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('handles text without any sentence ender', () => {
    expect(splitSegments('只有一句沒有句號').map((s) => s.text)).toEqual(['只有一句沒有句號'])
  })
})

describe('solo narration is never merged back', () => {
  const m = (id: string, text: string, solo = false): Message => ({ id, type: 'narration_short', speaker: null, text, solo })
  it('keeps a solo line separate from its neighbours', () => {
    const out = mergeAdjacentNarration([m('a', '前文'), m('b', '獨立一行', true), m('c', '後文')])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})
