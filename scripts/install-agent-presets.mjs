import { cp, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Copies each source-controlled agent preset under `agent-presets/` into the
// shipped preset root inside `@deepseek-ai/dsh`'s config directory. That root
// is what `dsh` mounts as `system` presets beside `standard`, `code`, `minimal`,
// and `cordis`, so a preset added here becomes a built-in work mode for every
// DSH Desktop install after `npm install` (and after the next `npm run build`
// for packaged artifacts, since `node_modules/**` is shipped unpacked).
//
// Presets are whole-directory units (`<id>/preset.yml`, `<id>/agent.cordis.yml`,
// and any bundled `skills/`). This script never removes or rewrites the shipped
// built-ins — it only adds or refreshes directories named under `agent-presets/`.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = path.join(projectRoot, 'agent-presets')
const destinationDirectory = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'config',
  'agent-presets'
)

const entries = await readdir(sourceDirectory, { withFileTypes: true })
const presets = entries.filter((entry) => entry.isDirectory())

await mkdir(destinationDirectory, { recursive: true })

const installed = []
for (const preset of presets) {
  const from = path.join(sourceDirectory, preset.name)
  const to = path.join(destinationDirectory, preset.name)
  await cp(from, to, { recursive: true, force: true })
  installed.push(path.relative(projectRoot, to))
}

console.log(
  `Installed DSH agent presets: ${installed.length === 0 ? '(none)' : installed.join(', ')}`
)
