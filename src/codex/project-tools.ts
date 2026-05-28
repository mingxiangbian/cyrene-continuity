import { getReadableCodexProjectMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import {
  addCodexProjectAlias,
  listCodexProjects,
  mergeCodexProjects,
  type CodexProjectRegistryEntry
} from './project-registry.js'

export async function formatCodexProjectStatus(input: { cwd: string }): Promise<string> {
  const current = await identifyCodexProject(input.cwd)
  const [projects, readableCurrentRoot] = await Promise.all([
    listCodexProjects(),
    getReadableCodexProjectMemoryRoot(current.projectId)
  ])
  const splitCandidates = findSplitCandidates(projects, current.projectId, current.displayName)
  const splitStatus = splitCandidates.length > 0 ? 'possible' : projects.length > 1 ? 'multiple-roots' : 'none'

  return [
    'Cyrene Project Status',
    '',
    'current:',
    `  projectId: ${current.projectId}`,
    `  displayName: ${current.displayName}`,
    `  cwd: ${current.cwd}`,
    `  git root: ${current.gitRoot ?? 'none'}`,
    `  remote hash: ${current.gitRemoteHash ?? 'none'}`,
    '',
    'project memory:',
    `  root: ${codexProjectMemoryRoot(current.projectId)}`,
    `  exists: ${readableCurrentRoot === null ? 'no' : 'yes'}`,
    '',
    'diagnostics:',
    `  known project roots: ${projects.length}`,
    `  projectId split: ${splitStatus}`,
    splitCandidates.length === 0 ? undefined : `  split candidates: ${splitCandidates.map((item) => item.projectId).join(', ')}`,
    splitCandidates.length === 0
      ? undefined
      : `  action: cyrene-continuity codex project merge ${splitCandidates[0]?.projectId} ${current.projectId}`,
    ''
  ].filter((line): line is string => line !== undefined).join('\n')
}

export async function formatCodexProjectList(input: { cwd: string }): Promise<string> {
  const current = await identifyCodexProject(input.cwd)
  const projects = await listCodexProjects()
  return [
    'Cyrene Projects',
    '',
    `current projectId: ${current.projectId}`,
    '',
    'projects:',
    ...projects.map((project) => formatProjectListEntry(project, project.projectId === current.projectId)),
    ''
  ].join('\n')
}

export async function runCodexProjectAlias(input: { projectId: string; alias: string }): Promise<string> {
  const project = await addCodexProjectAlias(input)
  return [
    'Cyrene Project Alias',
    `projectId: ${project.projectId}`,
    `aliases: ${formatList(project.aliases)}`,
    ''
  ].join('\n')
}

export async function runCodexProjectMerge(input: { fromProjectId: string; toProjectId: string }): Promise<string> {
  const result = await mergeCodexProjects(input)
  return [
    'Cyrene Project Merge',
    `merged from: ${result.fromProjectId}`,
    `merged into: ${result.toProjectId}`,
    `merged files: ${formatList(result.mergedFiles)}`,
    ''
  ].join('\n')
}

function findSplitCandidates(
  projects: CodexProjectRegistryEntry[],
  currentProjectId: string,
  currentDisplayName: string
): CodexProjectRegistryEntry[] {
  return projects
    .filter((project) => project.projectId !== currentProjectId)
    .filter((project) => project.aliases.includes(currentProjectId) || project.aliases.includes(currentDisplayName))
}

function formatProjectListEntry(project: CodexProjectRegistryEntry, current: boolean): string {
  return [
    `  - projectId: ${project.projectId}${current ? ' (current)' : ''}`,
    `    aliases: ${formatList(project.aliases)}`,
    `    mergedFrom: ${formatList(project.mergedFrom)}`,
    `    mergedInto: ${project.mergedInto ?? 'none'}`,
    `    active: ${project.counts.active}`,
    `    pending: ${project.counts.pending}`,
    `    tombstones: ${project.counts.tombstones}`,
    `    memory root: ${project.memoryRoot}`
  ].join('\n')
}

function formatList(values: string[]): string {
  return values.length === 0 ? 'none' : values.join(', ')
}
