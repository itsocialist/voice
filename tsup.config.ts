import { defineConfig } from 'tsup';

/**
 * Build config for v0.3.0 — emits ESM (.mjs) + CJS (.js) + .d.ts to dist/.
 *
 * Entry points map 1:1 to the public `exports` field in package.json. Each
 * Next handler is its own entry because the README documents deep imports
 * like `@itsocialist/voice/next/tts-handler` and we keep that shape.
 *
 * react/index.ts pulls hooks/components as relative imports; tsup bundles
 * them into a single output per format. "use client" directives at the
 * top of hook/component files are preserved by esbuild.
 */
export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'next/index': 'next/index.ts',
    'next/tts-handler': 'next/tts-handler.ts',
    'next/stt-handler': 'next/stt-handler.ts',
    'next/convai-handler': 'next/convai-handler.ts',
    'react/index': 'react/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  // Sourcemaps disabled: they reference ../src/*.ts paths that aren't shipped,
  // so consumers get broken map links. Revisit if we publish source separately.
  sourcemap: false,
  clean: true,
  // External: peer deps and runtime deps shouldn't be bundled — consumers
  // resolve them. The @elevenlabs/* packages are dependencies (not peers)
  // but should still resolve via node_modules at consume time, not bundle.
  external: [
    'react',
    'react-dom',
    'next',
    '@elevenlabs/client',
    '@elevenlabs/react',
  ],
  // Preserve directive comments like "use client" at the top of React files.
  // esbuild strips them by default; this banner pattern keeps them per-entry.
  esbuildOptions(options) {
    options.banner = {
      // No-op — directives are preserved by esbuild when at the top of an
      // entry file. If tsup ever strips them, we can re-add via this banner.
    };
  },
  treeshake: true,
  splitting: false,
});
