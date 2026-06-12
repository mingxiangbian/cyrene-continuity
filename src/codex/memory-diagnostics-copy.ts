export const MEMORY_JSONL_REPAIR_DRY_RUN_ACTION = 'action: run cyrene-continuity codex memory jsonl repair --dry-run'
export const MEMORY_JSONL_REPAIR_APPLY_ACTION = 'action: after reviewing the preview, run cyrene-continuity codex memory jsonl repair --apply'
export const MEMORY_INDEX_REBUILD_ACTION = 'action: run cyrene-continuity codex memory db rebuild'
export const PROJECT_HARVEST_PREVIEW_REQUIRED_ACTION =
  'action: run cyrene-continuity codex memory harvest-project, then apply with --apply --preview-id <id> --preview-hash <hash>'
export const PROJECT_HARVEST_PREVIEW_EXPIRED_ACTION =
  'action: preview expired; run cyrene-continuity codex memory harvest-project again'

export function repairRequiredAction(): string[] {
  return [
    MEMORY_JSONL_REPAIR_DRY_RUN_ACTION,
    MEMORY_JSONL_REPAIR_APPLY_ACTION
  ]
}

export function indexStaleAction(): string {
  return MEMORY_INDEX_REBUILD_ACTION
}

export function previewRequiredAction(): string {
  return PROJECT_HARVEST_PREVIEW_REQUIRED_ACTION
}

export function previewExpiredAction(): string {
  return PROJECT_HARVEST_PREVIEW_EXPIRED_ACTION
}
