import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client.tsx' },
  outDir: 'lib/client-build',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  deps: { neverBundle: ['react', /^@deepseek-ai\//] },
})
