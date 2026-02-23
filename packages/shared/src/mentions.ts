const MENTION_REGEX = /@([a-zA-Z0-9_][\w-]*)/g

export function parseMentions(content: string): string[] {
  const seen = new Set<string>()
  const mentions: string[] = []
  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1])
      mentions.push(match[1])
    }
  }
  return mentions
}

export function hasMention(content: string, name: string): boolean {
  return new RegExp(`@${escapeRegex(name)}\\b`).test(content)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function insertMention(content: string, name: string, position: number): string {
  const clamped = Math.max(0, Math.min(position, content.length))
  return content.slice(0, clamped) + `@${name} ` + content.slice(clamped)
}
