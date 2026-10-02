import { describe, expect, it } from 'vitest'
import { detectCharacters } from './characters'
import { applyRuleToMessages, createContext, parseChapter, reinferFrom, rulePrefix } from './parser'
import { splitChapters } from './chapters'

const sample = `第一章 雨夜
夜很深，雨一直下。
李明說：「你怎麼還沒睡？」
王芳笑道：「睡不著。」
「我也是。」李明輕聲說道。
王芳大喊：「不要再逃避了！！」
李明心想，這下糟了。
他看著窗外，心中一片混亂，雨水沿著玻璃緩緩滑落，像是在替誰流淚，又像是什麼都沒有發生過一樣。
王芳微微一笑：「那就明天再說吧。」
「真的嗎？」「真的。」
李明說：「好。」王芳說，「晚安。」
王芳說：「你要記得吃藥。」
李明道：「知道了。」
李明說：「我去睡了。」
王芳笑道：「晚安。」
第二章 清晨
天亮了。`

describe('parser', () => {
  const chapters = splitChapters(sample)
  const names = detectCharacters(sample)
  const ctx = createContext(names)
  const msgs = parseChapter(chapters[0].text, 0, ctx)
  const find = (t: string) => msgs.find((m) => m.text.includes(t))!

  it('splits chapters', () => expect(chapters.map((c) => c.title)).toEqual(['第一章 雨夜', '第二章 清晨']))
  it('detects characters', () => expect(names).toEqual(expect.arrayContaining(['李明', '王芳'])))
  it('prefix dialog', () => expect(find('你怎麼還沒睡')).toMatchObject({ type: 'dialog', speaker: '李明' }))
  it('suffix dialog', () => expect(find('我也是')).toMatchObject({ type: 'dialog', speaker: '李明' }))
  it('shout', () => expect(find('不要再逃避')).toMatchObject({ type: 'shout', speaker: '王芳' }))
  it('thought', () => expect(find('這下糟了')).toMatchObject({ type: 'thought', speaker: '李明' }))
  it('long narration', () => expect(find('心中一片混亂').type).toBe('narration_long'))
  it('short narration', () => expect(find('雨一直下').type).toBe('narration_short'))
  it('action then quote', () => expect(find('明天再說')).toMatchObject({ type: 'dialog', speaker: '王芳' }))
  it('bare chain is a guess, not a certainty', () => expect(find('真的嗎')).toMatchObject({ type: 'dialog', guess: true }))
  it('insertion', () => expect(find('晚安。')).toMatchObject({ speaker: '王芳' }))
})

describe('narration merge & images', () => {
  const ctx = createContext(['李明'])
  const msgs = parseChapter('雨下了一夜。\n街上沒有人。\n⟦img:OEBPS/a.jpg⟧\n路燈忽明忽滅。\n李明說：「走吧。」', 0, ctx)
  it('merges consecutive narration into one', () => expect(msgs[0].text).toBe('雨下了一夜。\n街上沒有人。'))
  it('keeps image as its own message', () => expect(msgs[1]).toMatchObject({ type: 'image', text: 'OEBPS/a.jpg' }))
  it('image breaks merge, dialog follows', () => expect(msgs.map((m) => m.type)).toEqual(['narration_short', 'image', 'narration_short', 'dialog']))
})

describe('light-novel style', () => {
  const ctx = createContext(['艾蓮娜', '米蘭'])
  const run = (t: string) => parseChapter(t, 0, ctx)
  it('keeps inline term quotes inside narration', () => {
    const m = run('「赤焰龍」格雷夫發出了進化的呱呱聲，這是一個新生命的誕生。\n他看著天空。')
    expect(m).toHaveLength(1)
    expect(m[0].text).toContain('「赤焰龍」格雷夫')
  })
  it('keeps 『skill』 names inside narration', () => {
    expect(run('希薇雅用『烈風之盾』輕易地防住了凱爾的攻擊。')).toHaveLength(1)
  })
  it('fullwidth parens paragraph is a thought', () => {
    expect(run('（若是雷歐大人，能夠看穿一切嗎？）')[0].type).toBe('thought')
  })
  it('telepathy paragraph is dialogue', () => {
    expect(run('『諾亞，過來這邊』')[0].type).not.toBe('narration_short')
  })
  it('nested quotes stay in one message', () => {
    const m = run('「艾蓮娜，是個好「名字」呢。不會吧」')
    expect(m).toHaveLength(1)
    expect(m[0].text).toBe('艾蓮娜，是個好「名字」呢。不會吧')
  })
  it('scene break is its own message and is not merged', () => {
    const m = run('天黑了。\n＊\n天亮了。')
    expect(m.map((x) => x.text)).toEqual(['天黑了。', '＊', '天亮了。'])
  })
  it('narration after a quote attributes it and drops the bare attribution', () => {
    const m = run('「你也要去？」\n米蘭如此問道。\n兩人走向房間。')
    expect(m[0]).toMatchObject({ speaker: '米蘭', type: 'dialog' })
    expect(m.some((x) => x.text.includes('如此問道'))).toBe(false)
  })
})

describe('learning from corrections', () => {
  const names = ['艾蓮娜', '米蘭']
  const text = '艾蓮娜停下腳步。\n「你也要去嗎？」\n「是。」\n「為什麼？」\n「因為任務。」'

  it('fixing one speaker re-infers the guessed ones after it', () => {
    const ctx = createContext(names)
    const msgs = parseChapter(text, 0, ctx)
    const q = msgs.filter((m) => m.type !== 'narration_short' && m.type !== 'narration_long')
    expect(q[0]).toMatchObject({ speaker: '艾蓮娜', guess: true })
    const first = msgs.indexOf(q[0])
    // 使用者說:第一句其實是米蘭說的
    msgs[first] = { ...msgs[first], speaker: '米蘭', guess: false, edited: true }
    reinferFrom(msgs, ctx, first)
    expect(msgs[first + 1].speaker).toBe('艾蓮娜')
    expect(msgs[first + 2].speaker).toBe('米蘭')
    expect(msgs[first + 3].speaker).toBe('艾蓮娜')
  })

  it('learned prefix rule turns later narration into thoughts', () => {
    expect(rulePrefix('──這是因為、我太弱小了。')).toBe('──')
    expect(rulePrefix('普通的旁白')).toBeNull()
    const ctx = createContext(names, [{ prefix: '──', type: 'thought' }])
    const m = parseChapter('艾蓮娜看著天空。\n──我必須變強。', 0, ctx)
    expect(m[1]).toMatchObject({ type: 'thought', text: '我必須變強。', speaker: '艾蓮娜' })
  })

  it('applies a rule retroactively to an already-parsed chapter', () => {
    const ctx = createContext(names)
    const msgs = parseChapter('艾蓮娜看著天空。\n──我必須變強。\n風很大。', 0, ctx)
    const out = applyRuleToMessages(msgs, { prefix: '──', type: 'thought' }, 0, ctx)
    expect(out.map((m) => m.type)).toEqual(['narration_short', 'thought', 'narration_short'])
    expect(out[1].speaker).toBe('艾蓮娜')
  })
})

describe('title-style characters & vocatives', () => {
  const book = Array.from({ length: 4 }, () => '疾風騎士笑道：「走吧。」\n「好。」國王陛下說。\n疾風騎士隨性的說：「沒問題。」').join('\n')
  it('detects title-style speakers from attribution', () => {
    const names = detectCharacters(book)
    expect(names).toEqual(expect.arrayContaining(['疾風騎士']))
    expect(names).not.toContain('常常')
  })
  it('never picks the addressed person as the speaker', () => {
    const ctx = createContext(['青葉', '月影騎士'])
    const m = parseChapter('青葉騎士？他真的是個好人。\n「青葉兄弟，請稍待一會。」', 0, ctx)
    const q = m.find((x) => x.text.includes('請稍待'))!
    expect(q.speaker).not.toBe('青葉')
  })
  it('first-person narration is not dropped from names filter', () => {
    const ctx = createContext(['我', '國王'], [], true)
    const m = parseChapter('我苦笑著說：「好吧。」', 0, ctx)
    expect(m[0]).toMatchObject({ speaker: '我', type: 'dialog' })
  })
})

describe('thought detection precision', () => {
  const ctx = createContext(['希薇雅', '凱爾'])
  it('「這麼想,但…」is not split into a thought', () => {
    const m = parseChapter('雖然這麼想，但一想到可能會被拒絕就又感到害怕──', 0, ctx)
    expect(m).toHaveLength(1)
    expect(m[0].text).toContain('雖然這麼想')
  })
  it('「他想,…」with a subject is still a thought', () => {
    const m = parseChapter('希薇雅想，這樣下去不行。', 0, ctx)
    expect(m[0]).toMatchObject({ type: 'thought', speaker: '希薇雅' })
  })
  it('thought belongs to the recent POV character, not the last mentioned one', () => {
    const m = parseChapter(
      '希薇雅看著遠方。\n希薇雅嘆了口氣。\n希薇雅等待著。\n她努力吸引凱爾的注意力。\n（過分的傢夥……）',
      0,
      ctx,
    )
    expect(m[m.length - 1]).toMatchObject({ type: 'thought', speaker: '希薇雅' })
  })
})

describe('naming phrases', () => {
  it('「這是「嫉妒」」stays one narration, not split', () => {
    const m = parseChapter('這是「嫉妒」', 0, createContext(['希薇雅']))
    expect(m).toHaveLength(1)
    expect(m[0].text).toBe('這是「嫉妒」')
  })
})

describe('one paragraph, one narration style', () => {
  const ctx = createContext(['希薇雅'])
  it('pieces split by a quote share the same narration type', () => {
    const long = '他走進昏暗的房間，看見桌上放著一封已經泛黃的信，信封邊角破損，顯然放了很久很久。'
    const m = parseChapter(`${long}「這是什麼？」然後離開。`, 0, ctx)
    const narr = m.filter((x) => x.type === 'narration_short' || x.type === 'narration_long')
    expect(narr.length).toBeGreaterThanOrEqual(2)
    expect(new Set(narr.map((x) => x.type)).size).toBe(1)
  })
  it('a short standalone paragraph is still the short style', () => {
    expect(parseChapter('天亮了。', 0, ctx)[0].type).toBe('narration_short')
  })
})
