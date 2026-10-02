import { describe, expect, it } from 'vitest'
import { BURST_AMP, burstPoints } from './burst'

describe('burstPoints', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(burstPoints(200, 60, 'a')).toBe(burstPoints(200, 60, 'a'))
    expect(burstPoints(200, 60, 'a')).not.toBe(burstPoints(200, 60, 'b'))
  })
  it('spike count scales with perimeter instead of stretching spikes', () => {
    const n = (w: number, h: number) => burstPoints(w, h, 's').split(' ').length
    expect(n(400, 80)).toBeGreaterThan(n(100, 40) * 2)
  })
  it('stays within the svg box (amp margin on every side)', () => {
    const w = 180
    const h = 70
    for (const p of burstPoints(w, h, 'x').split(' ')) {
      const [x, y] = p.split(',').map(Number)
      expect(x).toBeGreaterThanOrEqual(-1)
      expect(x).toBeLessThanOrEqual(w + BURST_AMP * 2 + 1)
      expect(y).toBeGreaterThanOrEqual(-1)
      expect(y).toBeLessThanOrEqual(h + BURST_AMP * 2 + 1)
    }
  })
})
