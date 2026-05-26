import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexStopHookCommand, formatCodexStopHookInstall, installCodexStopHook } from '../src/codex/codex-hook-install.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex Stop hook install', () => {
  it('uses a repo-local npm command for the Stop hook', () => {
    const command = codexStopHookCommand()

    expect(command).toContain('npm --prefix')
    expect(command).toContain(process.cwd())
    expect(command).toContain('run --silent dev -- codex hook stop')
  })

  it('dry-runs without writing hooks.json', async () => {
    const home = await createTempDir('cyrene-codex-hook-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    const output = await formatCodexStopHookInstall({ hooksPath, dryRun: true })

    expect(output).toContain('dry-run')
    expect(output).toContain('codex hook stop')
    await expect(readFile(hooksPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges with an existing Stop hook and stays idempotent', async () => {
    const home = await createTempDir('cyrene-codex-hook-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    const output = await formatCodexStopHookInstall({ hooksPath, dryRun: true })
    const dryRunConfig = JSON.parse(output.slice(output.indexOf('{'))) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    const cyreneCommand = dryRunConfig.hooks.Stop.flatMap((entry) => entry.hooks).find((hook) =>
      hook.command.includes('codex hook stop')
    )?.command

    expect(cyreneCommand).toBeDefined()

    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
              },
              {
                hooks: [{ type: 'command', command: cyreneCommand, timeout: 5 }]
              }
            ]
          }
        },
        null,
        2
      )
    )

    await installCodexStopHook({ hooksPath })
    await installCodexStopHook({ hooksPath })

    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string; timeout: number }> }> }
    }
    const installedHooks = parsed.hooks.Stop.flatMap((entry) => entry.hooks)
    const commands = installedHooks.map((hook) => hook.command)
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands.filter((command) => command.includes('codex hook stop'))).toHaveLength(1)
    expect(installedHooks.find((hook) => hook.command.includes('codex hook stop'))?.timeout).toBe(30)
  })

  it('replaces old Cyrene bridge Stop hooks while preserving unrelated hooks', async () => {
    const home = await createTempDir('cyrene-codex-hook-replace-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'npm --prefix /Users/phoenix/Assistant/Cyrene run --silent dev -- codex hook stop',
                    timeout: 30
                  }
                ]
              }
            ]
          }
        },
        null,
        2
      )
    )

    await installCodexStopHook({ hooksPath })

    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string; timeout: number }> }> }
    }
    const commands = parsed.hooks.Stop.flatMap((entry) => entry.hooks).map((hook) => hook.command)
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands).toContain(codexStopHookCommand())
    expect(commands).not.toContain('npm --prefix /Users/phoenix/Assistant/Cyrene run --silent dev -- codex hook stop')
  })

  it('installs the Cyrene Stop hook with a 30 second timeout', async () => {
    const home = await createTempDir('cyrene-codex-hook-timeout-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')

    await installCodexStopHook({ hooksPath })

    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string; timeout: number }> }> }
    }
    const cyreneHook = parsed.hooks.Stop.flatMap((entry) => entry.hooks).find((hook) =>
      hook.command.includes('codex hook stop')
    )
    expect(cyreneHook?.timeout).toBe(30)
  })
})
