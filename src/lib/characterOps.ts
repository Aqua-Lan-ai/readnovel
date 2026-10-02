import { getChapter, putChapter, putMeta } from './storage'
import type { BookMeta, CharacterOp } from './types'

/** 對所有「已解析」章節的說話者套用轉換;回傳受影響的訊息則數 */
async function mapSpeakers(meta: BookMeta, fn: (speaker: string) => string | null | undefined): Promise<number> {
  let affected = 0
  for (let i = 0; i < meta.chapterTitles.length; i++) {
    const data = await getChapter(meta.id, i)
    if (!data?.messages) continue
    let changed = false
    const messages = data.messages.map((m) => {
      if (m.speaker === null) return m
      const next = fn(m.speaker)
      if (next === undefined || next === m.speaker) return m
      changed = true
      affected++
      return { ...m, speaker: next, ...(next === null ? { guess: false } : {}) }
    })
    if (changed) await putChapter(meta.id, i, { ...data, messages })
  }
  return affected
}

const pushOp = (meta: BookMeta, op: CharacterOp) => [...(meta.characterOps ?? []), op]

export interface RenameResult {
  meta: BookMeta
  affected: number
  merged: boolean
}

/** 改名;新名字已存在時等同合併(呼叫端應先確認) */
export async function renameCharacter(meta: BookMeta, from: string, rawTo: string): Promise<RenameResult> {
  const to = rawTo.trim()
  if (!to || to === from) return { meta, affected: 0, merged: false }
  const merged = meta.characters.includes(to)
  const affected = await mapSpeakers(meta, (s) => (s === from ? to : undefined))

  // 之後才解析的章節:原文寫的還是舊名,靠對照表換成新名
  const aliases: Record<string, string> = { ...meta.aliases }
  for (const [k, v] of Object.entries(aliases)) if (v === from) aliases[k] = to
  delete aliases[to]
  aliases[from] = to

  const characters = merged
    ? meta.characters.filter((c) => c !== from)
    : meta.characters.map((c) => (c === from ? to : c))
  const next: BookMeta = {
    ...meta,
    characters,
    aliases,
    me: meta.me === from ? to : meta.me,
    characterOps: pushOp(meta, { op: merged ? 'merge' : 'rename', from, to, at: Date.now() }),
  }
  await putMeta(next)
  return { meta: next, affected, merged }
}

/** 刪除角色:它的訊息變成「未知角色」,之後也不會再被辨識出來 */
export async function deleteCharacter(meta: BookMeta, name: string): Promise<{ meta: BookMeta; affected: number }> {
  const affected = await mapSpeakers(meta, (s) => (s === name ? null : undefined))
  const aliases = Object.fromEntries(Object.entries(meta.aliases ?? {}).filter(([k, v]) => k !== name && v !== name))
  const characters = meta.characters.filter((c) => c !== name)
  const next: BookMeta = {
    ...meta,
    characters,
    aliases,
    me: meta.me === name ? (characters[0] ?? null) : meta.me,
    characterOps: pushOp(meta, { op: 'delete', from: name, at: Date.now() }),
  }
  await putMeta(next)
  return { meta: next, affected }
}
