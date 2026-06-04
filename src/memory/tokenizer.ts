import { createHash } from 'node:crypto'

export const MEMORY_TOKEN_ALIASES: Record<string, string[]> = {
  '多智能体': ['multi-agent', 'multi_agent', 'multiagent'],
  '仓库': ['repo', 'repository'],
  '审查': ['review', 'audit'],
  '验证': ['verify', 'validation', 'verification'],
  '记忆': ['memory'],
  '自动化': ['automation'],
  '上下文': ['context'],
  '污染': ['pollution']
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'for',
  'from',
  'if',
  'in',
  'include',
  'into',
  'is',
  'it',
  'its',
  'may',
  'must',
  'note',
  'notes',
  'of',
  'on',
  'or',
  'outline',
  'plan',
  'should',
  'test',
  'that',
  'the',
  'then',
  'these',
  'this',
  'those',
  'to',
  'was',
  'were',
  'when',
  'while',
  'will',
  'with',
  'without',
  'would',
  'write',
  'writing'
])

export function tokenizeMemoryText(text: string): string[] {
  const tokens = new Set<string>()
  const normalized = text.toLowerCase()
  for (const token of normalized.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*|[\u4e00-\u9fff]+/g) ?? []) {
    addToken(tokens, token)
    if (hasConnector(token)) {
      addToken(tokens, token.replace(/-/g, '_'))
      addToken(tokens, token.replace(/[-_]/g, ''))
      for (const part of token.split(/[-_]+/)) {
        addToken(tokens, part)
      }
    }
    if (isCjkToken(token)) {
      for (const gram of cjkNgrams(token)) {
        addToken(tokens, gram)
      }
    }
  }

  for (const [source, aliases] of Object.entries(MEMORY_TOKEN_ALIASES)) {
    if (normalized.includes(source)) {
      addToken(tokens, source)
      for (const alias of aliases) {
        addToken(tokens, alias)
      }
    }
  }

  return Array.from(tokens)
}

export function tokenOverlapScore(left: string | string[], right: string | string[]): number {
  const leftTokens = tokensForOverlap(left)
  const rightTokens = tokensForOverlap(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }
  let matches = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1
    }
  }
  return Number((matches / Math.min(leftTokens.size, rightTokens.size)).toFixed(4))
}

export function normalizeMemoryKey(text: string): string {
  const tokens = tokenizeMemoryText(text)
    .filter((token) => !isCjkToken(token) || token.length >= 2)
    .sort(compareTokensForKey)
  const slug = tokens
    .join('-')
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug.length > 0 ? slug : createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function addToken(tokens: Set<string>, token: string): void {
  const trimmed = token.trim().toLowerCase()
  if (trimmed === '' || STOP_WORDS.has(trimmed)) {
    return
  }
  tokens.add(trimmed)
}

function tokensForOverlap(input: string | string[]): Set<string> {
  return new Set(Array.isArray(input) ? input : tokenizeMemoryText(input))
}

function hasConnector(token: string): boolean {
  return /[-_]/.test(token)
}

function isCjkToken(token: string): boolean {
  return /^[\u4e00-\u9fff]+$/.test(token)
}

function cjkNgrams(token: string): string[] {
  const grams: string[] = []
  for (const size of [2, 3]) {
    for (let index = 0; index <= token.length - size; index += 1) {
      grams.push(token.slice(index, index + size))
    }
  }
  return grams
}

function compareTokensForKey(left: string, right: string): number {
  const leftAscii = isAsciiToken(left)
  const rightAscii = isAsciiToken(right)
  if (leftAscii !== rightAscii) {
    return leftAscii ? -1 : 1
  }
  return left.localeCompare(right)
}

function isAsciiToken(token: string): boolean {
  return /^[a-z0-9_-]+$/.test(token)
}
