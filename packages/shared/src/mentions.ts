// Mention names: start with alphanumeric/underscore, followed by alphanumeric/underscore/hyphen
const MENTION_REGEX = /@([a-zA-Z0-9_][a-zA-Z0-9_-]*)/g

// Character class that can follow a valid mention name
const MENTION_BOUNDARY = '[^a-zA-Z0-9_-]'

export function parseMentions(content: string): string[] {
  const seen = new Set<string>()
  const mentions: string[] = []
  MENTION_REGEX.lastIndex = 0
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
  // Use the same character set as parseMentions: the name must be followed
  // by a non-name character or end-of-string (consistent with MENTION_REGEX).
  return new RegExp(`@${escapeRegex(name)}(?=${MENTION_BOUNDARY}|$)`).test(content)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function insertMention(content: string, name: string, position: number): string {
  const clamped = Math.max(0, Math.min(position, content.length))
  return content.slice(0, clamped) + `@${name} ` + content.slice(clamped)
}
