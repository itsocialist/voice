# Breaking changes

This file tracks every breaking change shipped between major-bump releases.
For the additive changes that ride alongside, see [CHANGELOG.md](./CHANGELOG.md).

---

## v0.3.0 — 2026-05-12

### 1. Package layout: pre-built `dist/` instead of raw TypeScript source

**What changed**

v0.2.x shipped `src/**/*.ts` (and `react/**/*.tsx`, `next/**/*.ts`) as the
package contents, with `"main": "./src/index.ts"`. Consumers had to be in a
toolchain that could compile TypeScript on the fly — Next.js worked because
Next compiles dependencies in `transpilePackages`; plain Node, Remix, Vite SSR,
Bun, Cloudflare Workers, and other environments all failed.

v0.3.0 ships a pre-built `dist/` directory with:

- ESM (`.js`) and CJS (`.cjs`) outputs
- TypeScript declarations (`.d.ts` for ESM, `.d.cts` for CJS)
- A conditional `exports` map in `package.json` resolving each entry

The public **API surface is unchanged**. All exports (functions, types,
components, hooks) are the same — only the resolution mechanism changed.

**What you need to do**

If you were using `transpilePackages: ['@itsocialist/voice']` in
`next.config.js` to force Next to compile our source, **remove that entry** —
it's no longer needed and can mask other issues:

```diff
  // next.config.js
  module.exports = {
-   transpilePackages: ['@itsocialist/voice'],
  };
```

If you weren't using `transpilePackages`, no action needed.

### 2. `peerDependencies` for React capped at `<20`

**What changed**

v0.2.x declared `"react": ">=18.0.0"`, which would silently accept a future
React 20+ install — but we have not tested against it and the SDK assumes
React 18/19 hook semantics.

v0.3.0 changes to `"react": ">=18 <20"` and same for `react-dom`. npm/pnpm
will now refuse to install `@itsocialist/voice` against React 20+ until we
explicitly bump the cap.

**What you need to do**

If you're on React 18 or 19, no change needed. If you're on React 20+ (when
it ships), you'll see a peer-dep warning until we cap up — file an issue if
that blocks you.

### 3. `tsconfig` paths alias renamed: `@briandawson/voice` → `@itsocialist/voice`

**What changed**

A handful of internal files still referenced the previous scope name
(`@briandawson/voice`) in `tsconfig.json` paths aliases and in comment
strings. These are now updated to `@itsocialist/voice`.

If you forked voice-lib and adapted the `tsconfig.json` paths, update your
fork's aliases to match.

---

## v0.2.x and earlier

No formally documented breaking changes — v0.2.x was a minor-version stream
inside the 0.x prerelease window. See [CHANGELOG.md](./CHANGELOG.md) for the
full release-by-release history.
