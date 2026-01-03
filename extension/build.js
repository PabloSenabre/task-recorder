import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: ['chrome90'],
  format: 'iife', // Important: IIFE format for Chrome extension scripts
};

const entryPoints = [
  { in: 'src/background.ts', out: 'src/background' },
  { in: 'src/content.ts', out: 'src/content' },
  { in: 'src/popup.ts', out: 'src/popup' },
];

async function build() {
  try {
    for (const entry of entryPoints) {
      await esbuild.build({
        ...commonOptions,
        entryPoints: [entry.in],
        outfile: `dist/${entry.out}.js`,
      });
      console.log(`Built ${entry.in} -> dist/${entry.out}.js`);
    }
    console.log('Build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

async function watch() {
  console.log('Watching for changes...');
  
  const contexts = await Promise.all(
    entryPoints.map(entry =>
      esbuild.context({
        ...commonOptions,
        entryPoints: [entry.in],
        outfile: `dist/${entry.out}.js`,
      })
    )
  );

  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log('Watching...');
}

if (isWatch) {
  watch();
} else {
  build();
}

