export interface TranscriptMessage {
  role: string
  content: string
}

export function parseTranscriptMessages(text: string): TranscriptMessage[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return parseTranscriptLine(JSON.parse(line) as unknown)
      } catch {
        return []
      }
    })
}

export function recentTranscriptMessages(messages: TranscriptMessage[], limit = 40): TranscriptMessage[] {
  if (limit <= 0) {
    return []
  }
  return messages.slice(-limit)
}

function parseTranscriptLine(value: unknown): TranscriptMessage[] {
  const record = isRecord(value) ? value : undefined
  const source = isRecord(record?.message) ? record.message : record
  const role = asString(source?.role)
  const content = contentToString(source?.content)
  if (role === undefined || content === undefined) {
    return []
  }
  return [{ role, content }]
}

function contentToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const parts = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry]
    }
    if (isRecord(entry) && typeof entry.text === 'string') {
      return [entry.text]
    }
    return []
  })
  return parts.length > 0 ? parts.join('\n') : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
