/** 以字串為種子的小型亂數(同一則訊息每次畫出來的刺都一樣) */
function rng(seed: string) {
  let h = 1779033703
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const BURST_AMP = 12

/**
 * 漫畫「爆炸框」輪廓:沿著 w×h 的矩形外緣,交替放「底點」與向外的「刺尖」。
 * 刺的寬度固定(不會隨氣泡變長而被拉扁),高度與間距帶一點隨機感。
 * 座標已平移,讓矩形左上角落在 (amp, amp),回傳 SVG polygon 的 points。
 */
export function burstPoints(w: number, h: number, seed: string, amp = BURST_AMP): string {
  const rand = rng(seed)
  const per = 2 * (w + h)
  const at = (d: number): { x: number; y: number; nx: number; ny: number } => {
    d = ((d % per) + per) % per
    if (d < w) return { x: d, y: 0, nx: 0, ny: -1 }
    d -= w
    if (d < h) return { x: w, y: d, nx: 1, ny: 0 }
    d -= h
    if (d < w) return { x: w - d, y: h, nx: 0, ny: 1 }
    d -= w
    return { x: 0, y: h - d, nx: -1, ny: 0 }
  }
  const pts: string[] = []
  const count = Math.max(8, Math.round(per / 17))
  const step = per / count
  for (let i = 0; i < count; i++) {
    const d = i * step
    const base = at(d + (rand() - 0.5) * step * 0.2)
    const tipAt = at(d + step / 2)
    const len = amp * (0.55 + rand() * 0.45)
    // 底點略往內縮,讓刺根更深、更尖
    pts.push(`${(base.x + amp - base.nx * 2).toFixed(1)},${(base.y + amp - base.ny * 2).toFixed(1)}`)
    pts.push(`${(tipAt.x + amp + tipAt.nx * len).toFixed(1)},${(tipAt.y + amp + tipAt.ny * len).toFixed(1)}`)
  }
  return pts.join(' ')
}
