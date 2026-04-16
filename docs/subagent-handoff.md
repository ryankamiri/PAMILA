# PAMILA Sub-Agent Handoff

This repo is intentionally split so multiple sub-agents can work in parallel without stepping on each other. Treat the shared scaffold as the contract surface.

## Ownership Map

- Core Logic Agent owns `packages/core`.
- Database/API Agent owns `packages/db` and `apps/api`.
- Dashboard UI Agent owns `apps/web` and may consume `packages/ui`.
- Chrome Extension Agent owns `apps/extension`.
- Map/Commute Agent owns `ops/otp` plus commute/map modules once those modules exist.
- AI/Media Agent owns future AI/media service modules once those modules exist.

Root workspace files, design docs, and shared exported contract names are integration-owned. Do not rewrite them casually.

## Shared Contract Rules

- Import shared domain types from `@pamila/core`.
- Preserve exported type and constant names unless the integrator explicitly changes the contract.
- Additive changes to shared contracts are safer than renames.
- Runtime validation is intentionally deferred in the scaffold; agents may add validation inside their owned apps if needed.
- Keep product policy changes aligned with `product-design-doc.md` and `technical-design-doc.md`.

## Forbidden Cross-Edits

- Do not edit another agent's owned app or package to make your own tests pass.
- Do not replace root package scripts, workspace layout, or TypeScript configuration without calling it out.
- Do not implement source-site crawlers or automated search bots.
- Do not add paid API dependencies.
- Do not commit local runtime data, database files, cached media, or OTP downloads.

## Integration Expectations

Each agent should finish with:

- changed file list
- behavior implemented
- tests run
- known gaps
- assumptions made
- any contract changes needed from the integrator

The integrator will connect cross-package flows, resolve type conflicts, and decide when shared contracts should change.
