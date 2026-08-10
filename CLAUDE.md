<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

---

# Label Designer

Browser-based label editor for thermal printers. Pure client-side, no backend,
no accounts. Full plan lives in the Obsidian vault at
`Obsidian/Projects/Label Designer.md`.

## Non-negotiables

- **No ESLint, no Prettier, no standalone `tsc`.** `vp check` runs format, lint,
  and type-check together; `vp check --fix` fixes format and lint. Adding those
  tools separately is the specific mistake to avoid.
- **`src/core/` is frozen.** It holds the contracts every other module depends
  on. If you think it needs to change, stop and report rather than editing it.
- **Documents are immutable.** Undo/redo is a stack of `LabelDocument`
  snapshots. Never mutate a document, element, or nested value in place.
- **Everything is device pixels at the target DPI** (203). Inches exist only at
  the UI boundary. Never resample the output -- that is what destroys 1-bit
  thermal output.
- **`MonoRaster` is the canonical render artifact.** Transports consume it and
  nothing else. No transport-specific format (PDF, PNG, ZPL) may leak upward
  into the editor.
- **The rasterizer does not use Konva.** Konva is the editor's interaction
  layer; printing renders the document directly to a 2D context. See
  `src/core/canvas.ts`.

## Module ownership

Concurrent agents own disjoint directories. Stay inside yours.

| Module              | Directory                                              |
| ------------------- | ------------------------------------------------------ |
| Rasterizer          | `src/raster/**`                                        |
| PDF transport       | `src/transports/pdf/**`                                |
| Editor, UI, storage | `src/editor/**`, `src/ui/**`, `src/storage/**` (trunk) |
| Deploy              | `Dockerfile`, `deploy/**`, `README.md`                 |

Off-limits to everyone: `package.json`, `vite.config.ts`, `src/core/**`, and any
`__contract__.test.ts`.

**All dependencies are already installed.** If you think you need another, stop
and report it -- installing one conflicts with other agents.

## Contracts

Each module has a `__contract__.test.ts` defining its interface from the
outside, plus a stub `index.ts` fixing the exact signatures. Implement the
bodies. Do not change exported names or parameter shapes, and do not edit the
contract test to make it pass.

Shared fixtures live in `src/core/fixtures/`. Test against them so your output
is compatible with modules you never see.

## Verify

```
vp check <your dirs> && vp test --run <your dirs>
```

Both must be green before reporting done.
