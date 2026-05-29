#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(repoRoot, 'plugin/runtime/cyrene-continuity.mjs')
const execFileAsync = promisify(execFile)

await execFileAsync(process.execPath, [resolve(repoRoot, 'scripts/generate-ui-static.mjs')], { cwd: repoRoot })
await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: [resolve(repoRoot, 'src/main.ts')],
  absWorkingDir: repoRoot,
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info'
})
const source = await readFile(outfile, 'utf8')
await writeFile(
  outfile,
  source.replace(
    /^#!.*\n/,
    '#!/usr/bin/env node\nimport { createRequire as __cyreneCreateRequire } from "node:module";\nconst require = __cyreneCreateRequire(import.meta.url);\n'
  )
)
await chmod(outfile, 0o755)
