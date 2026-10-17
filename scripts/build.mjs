// Bundles src/ into extension/dist/ with esbuild.
//   node scripts/build.mjs [--watch]
import * as esbuild from 'esbuild';

const options = {
  entryPoints: {
    background: 'src/background/index.js',
    content: 'src/content/index.js',
    popup: 'src/popup/popup.js',
    vocab: 'src/vocab/vocab.js',
  },
  outdir: 'extension/dist',
  bundle: true,
  format: 'iife',
  target: 'firefox140',
  legalComments: 'none',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
