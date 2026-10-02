export type MsgType = 'dialog' | 'thought' | 'shout' | 'narration_short' | 'narration_long' | 'unknown' | 'image'

export interface Message {
  id: string
  type: MsgType
  speaker: string | null
  text: string
  edited?: boolean
  /** 使用者手動獨立出來的旁白,不會被自動併回相鄰旁白 */
  solo?: boolean
  /** 說話者是程式依上下文推測的 */
  guess?: boolean
  /** 推測且把握較低:畫面上才標「?」 */
  weak?: boolean
}

export interface Correction {
  chapter: number
  messageId: string
  text: string
  from: { type: MsgType; speaker: string | null }
  to: { type: MsgType; speaker: string | null }
  at: number
}

/** 從使用者修正學到的規則:以特定符號開頭的旁白,其實是別種訊息 */
export interface TypeRule {
  prefix: string
  type: MsgType
}

export interface BookMeta {
  id: string
  title: string
  addedAt: number
  chapterTitles: string[]
  characters: string[]
  /** 靠右顯示的主視角角色 */
  me: string | null
  progress: { chapter: number; scroll: number }
  corrections: Correction[]
  typeRules?: TypeRule[]
  /** 第一人稱敘事(「我」是說話者之一) */
  firstPerson?: boolean
  /** 改名後的對照:原文中的寫法 → 顯示名稱,讓之後才解析的章節也能套用 */
  aliases?: Record<string, string>
  characterOps?: CharacterOp[]
}

export interface CharacterOp {
  op: 'rename' | 'merge' | 'delete'
  from: string
  to?: string
  at: number
}

export interface ChapterData {
  text: string
  messages?: Message[]
}

export interface RawChapter {
  title: string
  text: string
}
