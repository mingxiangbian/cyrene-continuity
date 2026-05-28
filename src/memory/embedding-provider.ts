export interface EmbeddingDiagnostics {
  enabled: boolean
  provider?: string
  cacheHits: number
  cacheMisses: number
  fallbackReason?: string
}

export interface EmbeddingProvider {
  diagnostics: EmbeddingDiagnostics
  embedTexts(texts: string[]): Promise<number[][]>
}

export class NullEmbeddingProvider implements EmbeddingProvider {
  diagnostics: EmbeddingDiagnostics = { enabled: false, cacheHits: 0, cacheMisses: 0 }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map(() => [])
  }
}

class FailingEmbeddingProvider implements EmbeddingProvider {
  diagnostics: EmbeddingDiagnostics = {
    enabled: true,
    provider: 'fail',
    cacheHits: 0,
    cacheMisses: 0
  }

  async embedTexts(_texts: string[]): Promise<number[][]> {
    throw new Error('configured embedding provider failed')
  }
}

export function createEmbeddingProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider {
  const provider = env.CYRENE_EMBEDDING_PROVIDER?.trim()
  if (provider === undefined || provider === '' || provider === 'off' || provider === 'disabled') {
    return new NullEmbeddingProvider()
  }
  if (provider === 'fail') {
    return new FailingEmbeddingProvider()
  }
  return new NullEmbeddingProvider()
}

export function assertEmbeddingSafeText(text: string): void {
  if (containsAbsolutePath(text) || containsRawRemote(text) || containsSecretLikeValue(text)) {
    throw new Error('unsafe embedding text contains path, remote, or secret-like content')
  }
}

export function embeddingDiagnostics(provider: EmbeddingProvider): EmbeddingDiagnostics {
  return { ...provider.diagnostics }
}

export function recordEmbeddingFallback(provider: EmbeddingProvider, reason: string): void {
  provider.diagnostics = {
    ...provider.diagnostics,
    fallbackReason: reason
  }
}

export function recordEmbeddingCacheMisses(provider: EmbeddingProvider, count: number): void {
  provider.diagnostics = {
    ...provider.diagnostics,
    cacheMisses: provider.diagnostics.cacheMisses + count
  }
}

function containsAbsolutePath(content: string): boolean {
  const unixPath = /(^|[\s`'"([{<:=,;])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-][^\s`'")\]}>]*/
  const windowsPath = /(^|[\s`'"([{<:=,;])[A-Za-z]:\\(?:[^\\\s`'")\]}>]+\\)+[^\\\s`'")\]}>]+/
  return unixPath.test(content) || windowsPath.test(content)
}

function containsRawRemote(content: string): boolean {
  return /(git@[A-Za-z0-9.-]+:[^\s`'")]+|(?:https?|git|ssh):\/\/(?:git@)?[A-Za-z0-9.-]+\/[^\s`'")]+(?:\.git)?\b)/.test(content)
}

function containsSecretLikeValue(content: string): boolean {
  return /\b(?:(?:sk|ghp|github_pat|xoxb)[_-][A-Za-z0-9_-]{24,}|(?:reviewHash|candidateHash)(?:\s*[=:]\s*|\s+)[a-fA-F0-9]{64})\b/.test(content)
}
