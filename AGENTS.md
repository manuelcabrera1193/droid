# Local Android MCP — agent instructions

## Goal

Maintain a local-only, model-agnostic MCP bridge between AI clients and Android
devices over ADB. The server must never select or call a language model. The
connected client supplies all reasoning.

## Start here

1. Read `README.md`.
2. Read `docs/AI-INTEGRATION.md` before changing behavior or integrating it into another project.
3. Read `docs/local-android.manifest.json` for the machine-readable contract.
4. Run `npm test`, `npm run check`, and the relevant smoke test.

## Architecture

- `src/index.ts`: dispatches between MCP stdio serving and installer CLI commands.
- `src/server.ts`: MCP tool schemas, annotations, and safe error responses.
- `src/adb.ts`: ADB discovery, device selection, validation, and shell-free process execution.
- `src/installer.ts`: cross-platform client detection, JSONC merge, backup, atomic writes, and vendor CLI invocation.
- `src/cli.ts`: `detect`, `doctor`, `setup/install`, and `uninstall` UX.
- `src/config.ts`: portable per-user device selection with atomic persistence.
- `src/emulator.ts`: allow-listed AVD discovery and detached startup.
- `src/ui.ts`: localhost-only device selector, protected HTTP API, and static UI.
- `tests/`: unit tests; add a failing test before changing behavior.

## Invariants

- Never add a generic `adb shell` or arbitrary command-execution tool.
- Always call processes with argument arrays and `shell: false`.
- Keep config paths derived from the runtime OS, home directory, XDG variables,
  `APPDATA`, `COPILOT_HOME`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR`; never commit
  a developer-specific absolute path.
- Setup must default to a read-only plan. State changes require `--yes`.
- Preserve unrelated client configuration, reject malformed files, back up before
  modification, and use an atomic same-directory rename.
- Do not put credentials in generated MCP configurations.
- Keep the UI bound to `127.0.0.1`; retain Host, Origin, token, CSP, and input checks.
- Keep no-argument `local-android-mcp` compatible with stdio MCP clients.

## Verification

```sh
npm run check
npm test
npm run smoke
npm run smoke:device
npm audit --audit-level=high
npm pack --dry-run
node dist/src/index.js detect --json
node dist/src/index.js setup --dry-run
```

The physical-device smoke is optional only when no authorized Android device is
available; report that limitation explicitly.
