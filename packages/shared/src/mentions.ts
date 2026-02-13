const MENTION_REGEX = /@(\w[\w-]*)/g

export function parseMentions(content: string): string[] {
  const mentions: string[] = []
  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    if (!mentions.includes(match[1])) {
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
  return content.slice(0, position) + `@${name} ` + content.slice(position)
}
