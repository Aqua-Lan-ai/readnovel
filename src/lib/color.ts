export function hashHue(name: string): number {
  let h = 5381
  for (const c of name) h = ((h << 5) + h + c.codePointAt(0)!) | 0
  return Math.abs(h) % 360
}

export const avatarColor = (name: string | null) =>
  name ? `hsl(${hashHue(name)} 55% 52%)` : 'hsl(220 8% 62%)'

export const avatarLetter = (name: string | null) => (name ? [...name][0] : '?')
