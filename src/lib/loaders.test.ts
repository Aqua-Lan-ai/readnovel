import { describe, expect, it } from 'vitest'
import { decodeText } from './loaders'

const buf = (b: number[]) => new Uint8Array(b).buffer
const utf16le = (s: string, bom = true) => {
  const out: number[] = bom ? [0xff, 0xfe] : []
  for (const ch of s) out.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8)
  return buf(out)
}

describe('decodeText', () => {
  const text = '【月影騎士】第1章\r\n　　我是一名騎士，正確來說，是月影騎士。\r\n'
  it('UTF-16LE with BOM', () => expect(decodeText(utf16le(text))).toBe(text))
  it('UTF-16LE without BOM', () => expect(decodeText(utf16le(text, false))).toBe(text))
  it('UTF-8 with BOM', () => expect(decodeText(buf([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text))
  it('UTF-8', () => expect(decodeText(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(text))
  it('Big5', () => {
    // 「我是騎士」的 Big5 編碼
    expect(decodeText(buf([0xa7, 0xda, 0xac, 0x4f, 0xc3, 0x4d, 0xa4, 0x68, 0x0a]))).toBe('我是騎士\n')
  })
  it('GBK', () => {
    // 「我是骑士」的 GBK 編碼
    expect(decodeText(buf([0xce, 0xd2, 0xca, 0xc7, 0xc6, 0xef, 0xca, 0xbf, 0x0a]))).toBe('我是骑士\n')
  })
})
