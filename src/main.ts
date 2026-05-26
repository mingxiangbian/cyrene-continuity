#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { handleCodexCommand } from './codex/codex-cli.js'
import { startCyreneMcpServer } from './mcp/mcp-server.js'

const program = new Command()

async function main(): Promise<void> {
  program
    .name('cyrene-continuity')
    .description('Cyrene continuity MCP and Codex bridge.')
    .argument('[command...]')
    .option('--cwd <path>', 'working directory', process.cwd())
    .allowUnknownOption()

  program.parse()

  const options = program.opts<{ cwd: string }>()
  const command = program.args[0]

  if (command === 'codex') {
    await handleCodexCommand({
      cwd: options.cwd,
      args: program.args.slice(1)
    })
    return
  }

  if (command === 'mcp-server') {
    if (program.args.length > 2 || (program.args[1] !== undefined && program.args[1] !== '--stdio')) {
      console.error('Usage: cyrene-continuity mcp-server --stdio')
      process.exit(1)
    }
    await startCyreneMcpServer({ cwd: options.cwd, transport: 'stdio' })
    return
  }

  console.error('Usage: cyrene-continuity <mcp-server --stdio|codex ...>')
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
