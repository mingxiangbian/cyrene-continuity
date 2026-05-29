import { CODEX_UI_STATIC_ASSETS, type CodexUiStaticAsset } from './codex-ui-static.generated.js'

export type { CodexUiStaticAsset }

export function getCodexUiStaticAsset(pathname: string): CodexUiStaticAsset | undefined {
  return CODEX_UI_STATIC_ASSETS[pathname]
}

export function listCodexUiStaticAssetPaths(): string[] {
  return Object.keys(CODEX_UI_STATIC_ASSETS)
}
