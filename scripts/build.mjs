import { build, context } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const watch = process.argv.includes('--watch')
const root = process.cwd()
const dist = resolve(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

for (const name of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(resolve(root, 'public', name), resolve(dist, name))
}

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
}

if (watch) {
  const popup = await context({ ...common, entryPoints: ['src/popup.js'], outfile: 'dist/popup.js' })
  const background = await context({ ...common, entryPoints: ['src/background.js'], outfile: 'dist/background.js' })
  await Promise.all([popup.watch(), background.watch()])
  console.log('Watching Canvas PDF Composer…')
} else {
  await Promise.all([
    build({ ...common, entryPoints: ['src/popup.js'], outfile: 'dist/popup.js' }),
    build({ ...common, entryPoints: ['src/background.js'], outfile: 'dist/background.js' }),
  ])
}
