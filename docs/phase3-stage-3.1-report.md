# Stage 3.1 Report — Workspace Scaffold & Configuration

**Date:** 2026-11-09  
**Scope:** Next.js app scaffold only. No wallet, SQLite, uploads, or escrow UI yet.  
**Solidity:** unchanged  

---

## What was done

1. Extended `pnpm-workspace.yaml` with `apps/*` (+ build approvals for Next/Tailwind native deps).
2. Created `apps/web` (`@evidencebound/web`):
   - Next.js **15.5.4** App Router + React **19.1.1** + TypeScript
   - Tailwind CSS **4.1.13**
   - `transpilePackages: ['@evidencebound/evidence', '@evidencebound/shared']`
   - Minimal home page importing `@evidencebound/shared` constants
   - Mock-funds disclaimer component
   - `.env.example` placeholders for later stages
3. Root scripts: `dev:web`, `build:web`.
4. `.gitignore`: `apps/web/.next/`, `apps/web/data/`.

---

## Commands run (this session)

| Command | Result |
| --- | --- |
| `pnpm install` | OK (5 workspace projects) |
| `pnpm build:evidence` | OK |
| `pnpm --filter @evidencebound/web build` | OK — compiled, static `/` generated |
| `pnpm test:evidence` | **28/28 passed** |
| `forge test --root packages/contracts` | **66/66 passed** |

Next.js build summary:

```text
✓ Compiled successfully
✓ Generating static pages (4/4)
Route (app)  /
○  (Static)
```

---

## Notes / non-blockers

- `next@15.5.4` marked deprecated by npm registry toward canaries; fine for MVP local research. Can bump later if needed.
- pnpm required approving build scripts for `@tailwindcss/oxide` and `sharp` (recorded in workspace allowBuilds).

---

## Stop

**Stage 3.1 complete.** Awaiting confirmation before Stage **3.2** (chain config, ABIs, deployment address export).
