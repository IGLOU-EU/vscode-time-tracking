const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`X [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    // The Node of the extension host at the engines.vscode floor, not engines.node (which is the
    // dev toolchain). VSCode 1.82 runs Electron 25 with Node 18.15.0
    // (https://code.visualstudio.com/updates/v1_82#_electron-25-update), and its remote server the
    // same Node (remote/.yarnrc on the release/1.82 branch of microsoft/vscode). Moves with the floor.
    target: 'node18.15',
    outfile: 'dist/extension.js',
    // 'vscode' is injected by the runtime: NEVER bundle it.
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
    return;
  }
  await ctx.rebuild();
  await ctx.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
