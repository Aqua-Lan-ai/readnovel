import { detectCharacters, detectFirstPerson } from './characters'
import type { DetectResult } from './characters.worker'

const WORKER_TIMEOUT_MS = 8000

/** 在背景執行緒偵測角色,避免大檔案讓畫面凍住;Worker 不可用、出錯或逾時就退回主執行緒。 */
export function detectInWorker(text: string): Promise<DetectResult> {
  return new Promise((resolve) => {
    let done = false
    let worker: Worker | undefined
    const finish = (r: DetectResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker?.terminate()
      resolve(r)
    }
    const fallback = () => {
      if (!done) setTimeout(() => finish({ names: detectCharacters(text), firstPerson: detectFirstPerson(text) }), 0)
    }
    const timer = setTimeout(fallback, WORKER_TIMEOUT_MS)
    try {
      worker = new Worker(new URL('./characters.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<DetectResult>) => finish(e.data)
      worker.onerror = fallback
      worker.onmessageerror = fallback
      worker.postMessage(text)
    } catch {
      fallback()
    }
  })
}

/** 讓出主執行緒,讓畫面有機會更新進度 */
export const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0))
