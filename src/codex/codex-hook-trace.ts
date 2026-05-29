import { appendCodexHookTrace, type CodexHookTraceEventName, type CodexHookTraceTool } from './hook-trace-store.js'

export interface CodexHookCommandOutput {
  continue: true
  suppressOutput: true
}

type CodexLifecycleHookEvent = Exclude<CodexHookTraceEventName, 'stop'>

const DEFAULT_HOOK_OUTPUT: CodexHookCommandOutput = {
  continue: true,
  suppressOutput: true
}

export async function handleCodexHookTraceCommand(
  event: CodexLifecycleHookEvent,
  rawInput?: string
): Promise<string> {
  try {
    const raw = rawInput ?? await readTextFromStdin()
    const payload = parsePayload(raw)
    if (payload !== undefined) {
      await appendCodexHookTrace(toTraceInput(event, payload))
    }
  } catch {
    // Codex lifecycle hooks must fail open.
  }

  return formatCodexHookTraceCommandOutput()
}

export function formatCodexHookTraceCommandOutput(): string {
  return `${JSON.stringify(DEFAULT_HOOK_OUTPUT)}\n`
}

async function readTextFromStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
  }
  return text
}

function parsePayload(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return {}
  }
  const parsed = JSON.parse(trimmed) as unknown
  return isRecord(parsed) ? parsed : undefined
}

function toTraceInput(event: CodexLifecycleHookEvent, payload: Record<string, unknown>): Parameters<typeof appendCodexHookTrace>[0] {
  const cwd = asString(payload.cwd) ?? process.cwd()
  const prompt = firstString(payload.prompt, payload.text, payload.user_prompt, payload.userPrompt)
  const tool = event === 'post_tool_use' ? parseTool(payload) : undefined

  return {
    cwd,
    event,
    sessionId: asString(payload.session_id) ?? asString(payload.sessionId),
    turnId: asString(payload.turn_id) ?? asString(payload.turnId),
    summary: summaryForEvent(event, prompt, tool),
    signals: signalsForEvent(event, prompt, tool),
    ...(tool === undefined ? {} : { tool })
  }
}

function summaryForEvent(event: CodexLifecycleHookEvent, prompt: string | undefined, tool: CodexHookTraceTool | undefined): string {
  if (event === 'session_start') {
    return 'Session started.'
  }
  if (event === 'user_prompt_submit') {
    return prompt === undefined ? 'User prompt submitted.' : `User prompt submitted: ${compact(prompt, 140)}`
  }
  return `Tool used: ${tool?.name ?? 'unknown'}`
}

function signalsForEvent(
  event: CodexLifecycleHookEvent,
  prompt: string | undefined,
  tool: CodexHookTraceTool | undefined
): string[] {
  if (event === 'user_prompt_submit' && prompt !== undefined) {
    return [`prompt=${compact(prompt, 180)}`]
  }
  if (event === 'post_tool_use') {
    return [
      tool?.commandSummary === undefined ? undefined : `command=${compact(tool.commandSummary, 180)}`,
      tool?.outputSummary === undefined ? undefined : `output=${compact(tool.outputSummary, 180)}`,
      tool?.touchedFiles === undefined || tool.touchedFiles.length === 0 ? undefined : `files=${tool.touchedFiles.join(', ')}`
    ].filter((signal): signal is string => signal !== undefined)
  }
  return []
}

function parseTool(payload: Record<string, unknown>): CodexHookTraceTool | undefined {
  const nested = isRecord(payload.tool) ? payload.tool : {}
  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : isRecord(payload.toolInput) ? payload.toolInput : {}
  const name = firstString(
    nested.name,
    nested.tool_name,
    nested.toolName,
    payload.tool_name,
    payload.toolName,
    payload.name
  ) ?? 'unknown'

  return {
    name: compact(name, 80),
    ...optionalField('useId', firstString(
      nested.id,
      nested.use_id,
      nested.useId,
      nested.tool_use_id,
      nested.toolUseId,
      payload.tool_use_id,
      payload.toolUseId
    )),
    ...optionalField('commandSummary', firstString(nested.command, toolInput.command, payload.command)),
    ...optionalField('outputSummary', firstString(
      nested.output,
      nested.result,
      responseSummary(payload.tool_response),
      responseSummary(payload.toolResponse),
      payload.output,
      payload.result
    )),
    ...optionalNumberField('exitCode', firstNumber(nested.exit_code, nested.exitCode, payload.exit_code, payload.exitCode)),
    ...optionalStringArrayField('touchedFiles', firstStringArray(
      nested.touched_files,
      nested.touchedFiles,
      nested.files,
      payload.touched_files,
      payload.touchedFiles,
      payload.files
    ))
  }
}

function responseSummary(value: unknown): string | undefined {
  const direct = asString(value)
  if (direct !== undefined) {
    return direct
  }
  if (!isRecord(value)) {
    return undefined
  }

  return firstString(value.output, value.result, value.content, value.text, value.stdout, value.stderr) ??
    JSON.stringify(value)
}

function optionalField<K extends keyof CodexHookTraceTool>(key: K, value: string | undefined): Partial<CodexHookTraceTool> {
  return value === undefined ? {} : { [key]: compact(value, 500) } as Partial<CodexHookTraceTool>
}

function optionalNumberField<K extends keyof CodexHookTraceTool>(key: K, value: number | undefined): Partial<CodexHookTraceTool> {
  return value === undefined ? {} : { [key]: value } as Partial<CodexHookTraceTool>
}

function optionalStringArrayField<K extends keyof CodexHookTraceTool>(key: K, value: string[] | undefined): Partial<CodexHookTraceTool> {
  return value === undefined ? {} : { [key]: value.map((entry) => compact(entry, 240)) } as Partial<CodexHookTraceTool>
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value)
    if (parsed !== undefined) {
      return parsed
    }
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

function firstStringArray(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      if (strings.length > 0) {
        return strings
      }
    }
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function compact(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, Math.max(0, maxLength - 1))}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
