import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import type { BookMeta } from './lib/types'

export default function App() {
  const [book, setBook] = useState<BookMeta | null>(null)
  return book ? <Reader initial={book} onBack={() => setBook(null)} /> : <Library onOpen={setBook} />
}
