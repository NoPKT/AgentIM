const agentAvatarGradients: Record<string, string> = {
  a: 'from-purple-500 to-violet-600',
  b: 'from-blue-500 to-indigo-600',
  c: 'from-cyan-500 to-teal-600',
  d: 'from-emerald-500 to-green-600',
  e: 'from-amber-500 to-orange-600',
  f: 'from-rose-500 to-pink-600',
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const gradientValues = Object.values(agentAvatarGradients)

export function getAvatarGradient(name: string): string {
  const idx = ALPHABET.indexOf(name.charAt(0).toLowerCase())
  if (idx >= 0) return gradientValues[idx % gradientValues.length]
  return 'from-blue-500 to-indigo-600'
}
