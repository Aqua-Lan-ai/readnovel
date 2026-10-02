import { alt, COMPOUND_SURNAMES, MODIFIERS, NAME_STOP_CHARS, SHOUT_VERBS, SPEECH_VERBS, SURNAMES, THOUGHT_VERBS } from './lexicon'

const MAX_CHARACTERS = 40

/** 句子開頭、說話動詞前面等位置的姓名(中文姓氏型) */
function detectBySurname(text: string): string[] {
  const surname = `${alt(COMPOUND_SURNAMES)}|[${SURNAMES}]`
  const verbs = alt([...SPEECH_VERBS, ...SHOUT_VERBS, ...THOUGHT_VERBS.filter((v) => v !== '想')])
  const mods = alt(MODIFIERS)
  const re = new RegExp(
    `(${surname})([\\u4e00-\\u9fff]{1,2}?)(?=(?:${mods})*(?:${verbs}|想[，,：:])|[：:][「『“"])`,
    'g',
  )
  const counts = new Map<string, number>()
  for (const m of text.matchAll(re)) {
    if ([...m[2]].some((c) => NAME_STOP_CHARS.has(c))) continue
    const name = m[1] + m[2]
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].filter(([, n]) => n >= 2).map(([name]) => name)
}

// ---- 不依賴姓氏的 n-gram 統計(音譯名、外國人名、稱號)----

const RIGHT_BOUNDARY = new Set([...'\n，。、！？…：；」』）”的了是在也都就和與還又把被對向說道問答想著一邊大等卻而但並才便再正已將會能要得到過地之曰'])
const LEFT_BOUNDARY = new Set([...'\n，。、！？…：；「『（“的了是在也都就和與還又把被對向跟說道問答想著而但並才便再正已將會能要得到過地之由為讓給使叫令從'])
const SENTENCE_START = new Set([...'\n，。！？…：；「『（“、'])
/** 出現在名字「前面」的虛詞(受詞/介詞位置),連接詞與副詞幾乎不會出現在這裡 */
const OBJECT_PREFIX = new Set([...'與和對向被把跟給讓叫令找看見的'])
const FUNCTION_WORDS = new Set(
  '他們 她們 它們 我們 你們 大家 眾人 所有人 雙方 在場 那傢夥 你這傢夥 自己 什麼 怎麼 這樣 那樣 這裡 那裡 現在 以及 或者 就算 即使 儘管 雖然 所以 因此 因為 如果 假如 只是 只有 不僅 同時 此外 另外 一旦 然後 於是 結果 最後 首先 其次 如今 任何 沒錯 勝利 沒問題 真正 大概 突然 停止 答案 名字 忍耐 事態 全員 不管怎麼 最重要 這不 常常 命令 孩子 皮膚 低頭 低吼 臉孔 無恥 很好'.split(' '),
)
/** 不會當人名開頭的字(代詞、否定、副詞) */
const NAME_FIRST_STOP = new Set([...'這那不沒最任每各其某另該此我你他她它牠妳很常全一轉補活學發'])
const HONORIFICS = ['大人', '先生', '小姐', '殿下', '閣下', '樣', '陛下', '大哥', '姐姐', '哥哥']

const isCjk = (code: number) => code >= 0x4e00 && code <= 0x9fff

function detectByNgram(text: string): string[] {
  const n = text.length
  const minCount = Math.max(8, Math.round(n / 80000))
  // runLen[i]:從 i 起連續漢字的長度
  const runLen = new Uint16Array(n + 1)
  for (let i = n - 1; i >= 0; i--) runLen[i] = isCjk(text.charCodeAt(i)) ? Math.min(runLen[i + 1] + 1, 65000) : 0

  const counts: Map<string, number>[] = []
  for (let len = 2; len <= 6; len++) {
    const m = new Map<string, number>()
    const prev = counts[len - 3]
    for (let i = 0; i + len <= n; i++) {
      if (runLen[i] < len) continue
      const w = text.substr(i, len)
      // Apriori:前綴與後綴都夠常見才可能是常見詞
      if (prev && ((prev.get(w.slice(0, -1)) ?? 0) < minCount || (prev.get(w.slice(1)) ?? 0) < minCount)) continue
      m.set(w, (m.get(w) ?? 0) + 1)
    }
    counts.push(m)
  }

  type Stat = { c: number; right: number; left: number; start: number; obj: number; hon: number }
  const stats = new Map<string, Stat>()
  for (const m of counts) for (const [w, c] of m) if (c >= minCount && !FUNCTION_WORDS.has(w)) stats.set(w, { c: 0, right: 0, left: 0, start: 0, obj: 0, hon: 0 })

  for (let len = 2; len <= 6; len++) {
    for (let i = 0; i + len <= n; i++) {
      if (runLen[i] < len) continue
      const st = stats.get(text.substr(i, len))
      if (!st) continue
      const prev = i ? text[i - 1] : '\n'
      const next = text[i + len] ?? '\n'
      st.c++
      if (RIGHT_BOUNDARY.has(next)) st.right++
      if (LEFT_BOUNDARY.has(prev)) st.left++
      if (SENTENCE_START.has(prev)) st.start++
      if (OBJECT_PREFIX.has(prev)) st.obj++
      if (HONORIFICS.some((h) => text.startsWith(h, i + len))) st.hon++
    }
  }

  const picked = [...stats]
    .filter(([w, s]) => {
      if (NAME_FIRST_STOP.has(w[0])) return false
      if (s.c < minCount || s.right / s.c < 0.5 || s.left / s.c < 0.6) return false
      const start = s.start / s.c
      // 專有名詞:常在句首,但也會當受詞;連接詞/副詞則幾乎全在句首
      return (start >= 0.15 && start <= 0.66 && s.obj / s.c >= 0.04) || s.hon / s.c >= 0.1
    })
    .map(([w, s]) => ({ w, c: s.c }))
    .sort((a, b) => b.c - a.c)

  // 去掉其他候選詞的衍生片段(如「雷歐大人」「是希薇雅」)
  return picked
    .filter((y) => !picked.some((x) => x.w !== y.w && y.w.includes(x.w) && y.c < x.c * 0.6))
    .map((x) => x.w)
}

/**
 * 「主詞 + 說話動詞 + 冒號/引號」是最直接的證據:取出該子句開頭的 2~5 字前綴並計數。
 * 能抓到稱號型角色(疾風騎士、國王、大王子)這類統計法與姓氏法抓不到的名字。
 */
function detectByAttribution(text: string): string[] {
  const verbs = alt([...SPEECH_VERBS, ...SHOUT_VERBS, ...THOUGHT_VERBS.filter((v) => v !== '想')])
  const mods = alt(MODIFIERS)
  const open = '[「『“"]'
  const startBoundary = '(?:^|[，,。！？、：；」』…\\n])'
  const head = '([\\u4e00-\\u9fff]{2,12}?)'
  const res = [
    // 前置型:XX(修飾)說:「
    new RegExp(`${startBoundary}${head}(?:${mods})*(?:${verbs})(?:著|着|了)?[，,：:]?(?=${open})`, 'gm'),
    // 後置型:「…」XX(修飾)說
    new RegExp(`[」』”]${head}(?:${mods})*(?:${verbs})(?:著|着|了)?(?=[，,。！？：:；]|$)`, 'gm'),
  ]
  const counts = new Map<string, number>()
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const h = m[1]
      for (let len = 2; len <= Math.min(5, h.length); len++) {
        const p = h.slice(0, len)
        counts.set(p, (counts.get(p) ?? 0) + 1)
      }
    }
  }
  const MIN = 3
  const cands = [...counts].filter(([, c]) => c >= MIN)
  // 前綴若被更長且夠常見的前綴取代(疾風 → 疾風騎士),就丟掉較短的
  return cands
    .filter(([p, c]) => !cands.some(([q, qc]) => q.length > p.length && q.startsWith(p) && qc >= c * 0.6))
    .map(([p]) => p)
}

/**
 * 全自動角色偵測:結合「姓氏 + 說話動詞」規則與 n-gram 統計,依出現次數排序。
 */
export function detectCharacters(text: string): string[] {
  const names = new Set(
    [...detectBySurname(text), ...detectByNgram(text), ...detectByAttribution(text)].filter(
      (w) => !FUNCTION_WORDS.has(w) && !NAME_FIRST_STOP.has(w[0]) && !/^(.)\1$/.test(w) && !/[的了著着是]$/.test(w),
    ),
  )
  const total = (name: string) => text.split(name).length - 1
  return [...names]
    .map((name) => ({ name, n: total(name) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_CHARACTERS)
    .map((x) => x.name)
}

/** 第一人稱敘事:「我說…」標註夠多,或旁白段落常以「我」開頭 */
export function detectFirstPerson(text: string): boolean {
  const verbs = alt([...SPEECH_VERBS, ...SHOUT_VERBS])
  const mods = alt(MODIFIERS)
  const re = new RegExp(`(?:^|[，,。！？、：；」』…\\n])我(?:${mods})*(?:${verbs})(?:著|着|了)?[，,：:]?[「『“]`, 'gm')
  if ((text.match(re) ?? []).length >= 5) return true
  const narration = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^[「『“"（(]/.test(l))
  if (narration.length < 30) return false
  const starts = narration.filter((l) => /^我(?![們们])/.test(l)).length
  return starts / narration.length >= 0.1
}
