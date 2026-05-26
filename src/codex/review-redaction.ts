export interface RedactionResult {
  text: string
  counts: Record<string, number>
}

type RedactionRule = {
  name: string
  pattern: RegExp
  replacement: string
}

const RULES: RedactionRule[] = [
  {
    name: 'privateKey',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
  {
    name: 'secret',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET)\s*=\s*["']?[^"'\s]+["']?/gi,
    replacement: '[REDACTED_SECRET]'
  },
  {
    name: 'secret',
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    replacement: '[REDACTED_SECRET]'
  },
  {
    name: 'secret',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/gi,
    replacement: 'Bearer [REDACTED_SECRET]'
  },
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]'
  },
  {
    name: 'secret',
    pattern: /\b[A-Fa-f0-9]{32,}\b/g,
    replacement: '[REDACTED_SECRET]'
  },
  {
    name: 'phone',
    pattern: /(?<!\d-)\b(?!\d{4}-\d{2}-\d{2}\b)(?:\+?\d[\d .()_-]{7,}\d)\b/g,
    replacement: '[REDACTED_PHONE]'
  }
]

export function mergeRedactionCounts(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  const merged = { ...left }

  for (const [name, count] of Object.entries(right)) {
    merged[name] = (merged[name] ?? 0) + count
  }

  return merged
}

export function redactReviewText(input: string): RedactionResult {
  let text = input
  let counts: Record<string, number> = {}

  for (const rule of RULES) {
    let count = 0

    text = text.replace(rule.pattern, () => {
      count += 1
      return rule.replacement
    })

    if (count > 0) {
      counts = mergeRedactionCounts(counts, { [rule.name]: count })
    }
  }

  return { text, counts }
}
