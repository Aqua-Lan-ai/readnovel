import { detectCharacters, detectFirstPerson } from './characters'

export interface DetectResult {
  names: string[]
  firstPerson: boolean
}

self.onmessage = (e: MessageEvent<string>) => {
  const result: DetectResult = { names: detectCharacters(e.data), firstPerson: detectFirstPerson(e.data) }
  ;(self as unknown as Worker).postMessage(result)
}
