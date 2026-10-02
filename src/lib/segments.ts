export interface Segment {
  text: string
  start: number
  end: number
}

/** 把一段旁白切成一句一句(句尾符號,連同收尾引號),保留在原文中的位置,方便選取後精準拆開。 */
export function splitSegments(text: string): Segment[] {
  const re = /[^。！？!?…\n]*[。！？!?…]+[」』”）)]*|[^。！？!?…\n]+/g
  const out: Segment[] = []
  for (const m of text.matchAll(re)) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}
