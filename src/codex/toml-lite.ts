export function hasEnabledTomlTable(configText: string, heading: string): boolean {
  const block = readTomlBlock(configText, heading)
  if (block === undefined) {
    return false
  }
  return readTomlBooleanValue(block, 'enabled') !== false
}

export function readTomlStringValue(block: string, key: string): string | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === undefined) {
    return undefined
  }
  return parseTomlString(value)
}

export function readTomlStringArrayValue(block: string, key: string): string[] | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === undefined) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

export function readTomlBooleanValue(block: string, key: string): boolean | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return undefined
}

export function readTomlAssignmentValue(block: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = block.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1]
  return value === undefined ? undefined : stripTomlInlineComment(value).trim()
}

export function readTomlBlock(configText: string, heading: string): string | undefined {
  const lines = configText.split(/\r?\n/)
  const start = lines.findIndex((line) => stripTomlInlineComment(line).trim() === heading)
  if (start < 0) {
    return undefined
  }
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(stripTomlInlineComment(lines[index] ?? ''))) {
      break
    }
    body.push(lines[index] ?? '')
  }
  return body.join('\n')
}

export function parseTomlString(value: string): string | undefined {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return undefined
}

export function stripTomlInlineComment(value: string): string {
  let quote: '"' | "'" | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        quote = undefined
      }
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') {
      return value.slice(0, index)
    }
  }
  return value
}
