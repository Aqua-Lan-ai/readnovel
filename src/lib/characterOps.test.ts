import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteCharacter, renameCharacter } from './characterOps'
import { createContext, parseChapter } from './parser'
import { getChapter, getMeta, putChapter, putMeta } from './storage'
import type { BookMeta, Message } from './types'

const msg = (id: string, speaker: string | null, guess = false): Message => ({ id, type: 'dialog', speaker, text: `台詞${id}`, guess })

let meta: BookMeta
beforeEach(async () => {
  meta = {
    id: `b-${Math.random()}`,
    title: 't',
    addedAt: 0,
    chapterTitles: ['一', '二', '三'],
    characters: ['艾蓮娜', '米蘭', '常常'],
    me: '艾蓮娜',
    progress: { chapter: 0, scroll: 0 },
    corrections: [],
  }
  await putMeta(meta)
  await putChapter(meta.id, 0, { text: '', messages: [msg('0-0', '艾蓮娜'), msg('0-1', '米蘭', true), msg('0-2', '常常')] })
  await putChapter(meta.id, 1, { text: '', messages: [msg('1-0', '艾蓮娜')] })
  await putChapter(meta.id, 2, { text: '未解析的原文' }) // 尚未解析
})

describe('character ops', () => {
  it('rename updates every parsed chapter, list, me, aliases and persists', async () => {
    const r = await renameCharacter(meta, '艾蓮娜', '艾琳娜')
    expect(r.affected).toBe(2)
    expect(r.merged).toBe(false)
    expect(r.meta.characters).toEqual(['艾琳娜', '米蘭', '常常'])
    expect(r.meta.me).toBe('艾琳娜')
    expect(r.meta.aliases).toEqual({ 艾蓮娜: '艾琳娜' })
    expect((await getChapter(meta.id, 0))!.messages!.map((m) => m.speaker)).toEqual(['艾琳娜', '米蘭', '常常'])
    expect((await getChapter(meta.id, 1))!.messages![0].speaker).toBe('艾琳娜')
    expect((await getChapter(meta.id, 2))!.messages).toBeUndefined()
    expect((await getMeta(meta.id))!.characterOps![0]).toMatchObject({ op: 'rename', from: '艾蓮娜', to: '艾琳娜' })
  })

  it('rename onto an existing name merges and keeps a single entry', async () => {
    const r = await renameCharacter(meta, '常常', '米蘭')
    expect(r.merged).toBe(true)
    expect(r.meta.characters).toEqual(['艾蓮娜', '米蘭'])
    expect((await getChapter(meta.id, 0))!.messages!.map((m) => m.speaker)).toEqual(['艾蓮娜', '米蘭', '米蘭'])
  })

  it('delete turns messages into unknown speaker and removes the name', async () => {
    const r = await deleteCharacter(meta, '常常')
    expect(r.affected).toBe(1)
    expect(r.meta.characters).toEqual(['艾蓮娜', '米蘭'])
    const m = (await getChapter(meta.id, 0))!.messages![2]
    expect(m.speaker).toBeNull()
    expect(m.guess).toBe(false)
  })

  it('deleting the main-view character picks a new one', async () => {
    const r = await deleteCharacter(meta, '艾蓮娜')
    expect(r.meta.me).toBe('米蘭')
  })

  it('chained renames keep aliases pointing at the latest name', async () => {
    const a = await renameCharacter(meta, '艾蓮娜', '艾琳娜')
    const b = await renameCharacter(a.meta, '艾琳娜', '艾琳')
    expect(b.meta.aliases).toEqual({ 艾蓮娜: '艾琳', 艾琳娜: '艾琳' })
  })
})

describe('aliases when parsing later chapters', () => {
  it('text still says the old name but the speaker shows the new one', () => {
    const ctx = createContext(['艾琳娜', '米蘭'], [], false, { 艾蓮娜: '艾琳娜' })
    const m = parseChapter('艾蓮娜說：「走吧。」', 0, ctx)
    expect(m[0]).toMatchObject({ type: 'dialog', speaker: '艾琳娜' })
  })
})
