# AI and project integration guide

This document is the implementation contract for developers and coding agents.

## What this component is

`local-android-mcp` is an MCP stdio server. It has no embedded model and no
provider dependency. Copilot, Codex, Claude, Cursor, Gemini, or another MCP
client decides which tool to call. The server validates the request and executes
only a small allow-listed ADB operation.

## Portable installation contract

The reusable runtime command is `local-android-mcp`. Client configurations must
reference that command, not this repository, a developer home directory, or a
generated `dist` path. On Windows the installer dynamically resolves the trusted
global npm shim and records it behind `cmd.exe /d /s /c call`; this prevents a
same-named script in an untrusted workspace from taking precedence. Rerun setup
after changing computers or the global Node installation.

To provision another computer:

```sh
npm install
npm run install:global
local-android-mcp setup
local-android-mcp setup --yes --force
local-android-mcp doctor
local-android-mcp ui
```

Copying the source folder is sufficient; the global installation creates an
independent packaged copy. Moving the source afterward does not affect clients.
The npm package is marked `private`, so registry publication is not enabled;
the GitHub repository is public. An organization that wants registry distribution must first adopt its
own scoped package name, review licensing/versioning, remove `private`, and keep
the same `bin` name.

## Installer behavior

`detect` checks PATH, application markers, and user configuration directories.
`setup` without `--yes` only displays a plan. `setup --yes` configures detected
clients. JSON and JSONC files are parsed before writing, unrelated keys and
comments are retained, conflicting `local-android` entries require `--force`,
and existing files receive a timestamped sibling backup. Writes use a temporary
file and same-directory atomic rename.

Uninstall verifies that JSON entries match the generated configuration. A
different same-named entry is retained unless `--force` is explicit. Provider
CLI configurations also require `--force` for uninstall because their formats
do not provide portable installer ownership metadata.

Codex, Claude Code, and Devin own evolving configuration formats, so their
official CLI is invoked with fixed argument arrays. Applying setup to those
clients requires explicit `--force`, because their CLI can replace an existing
same-named entry. Other supported clients use documented JSON/JSONC locations.
No generated configuration contains a secret.

The device selected by `local-android-mcp ui` is stored in the current user's
OS-specific application configuration directory. MCP processes read it on every
tool call. An explicit tool `device` and `ANDROID_SERIAL` take precedence, so a
caller can temporarily target another device without rewriting the preference.

## Integrating into another repository

Choose one approach:

1. **User-wide (recommended):** globally install this package and run `setup --yes`.
2. **Workspace portable:** copy the root `.mcp.json` pattern into the project and
   ensure the project has this package plus an `mcp` script.
3. **Manual client entry:** merge `examples/global-mcp.json` into the client's
   documented global configuration on macOS/Linux. On Windows use the installer
   so it can resolve and pin the trusted npm shim safely.

An AI implementing option 2 must not copy an absolute path. The portable entry is:

```json
{
  "mcpServers": {
    "local-android": {
      "command": "local-android-mcp",
      "args": []
    }
  }
}
```

For VS Code's `.vscode/mcp.json`, use top-level `servers` and add
`"type": "stdio"` to the server entry.

## Tool contract

Read-only tools:

- `android_list_devices`
- `android_device_info`
- `android_screenshot`
- `android_get_ui_tree`
- `android_list_packages`

Device-changing tools:

- `android_tap`
- `android_swipe`
- `android_type_text`
- `android_press_key`
- `android_launch_app`
- `android_force_stop_app`

If multiple authorized devices exist, provide the `device` serial or set
`ANDROID_SERIAL`. ADB resolution order is `ANDROID_ADB_PATH`, `ADB_PATH`,
`ANDROID_SDK_ROOT`, `ANDROID_HOME`, then PATH.

## Safety requirements for extensions

- Do not expose arbitrary shell commands, package installation, uninstallation,
  clear-data, reboot, root, or unrestricted file transfer.
- Validate every parameter with an allow-list and bounds.
- Keep `spawn(..., { shell: false })` and pass arguments separately.
- Annotate state-changing and destructive tools accurately.
- Add tests for both accepted and rejected values.
- Preserve tool output caps and timeouts.

## Acceptance checks

```sh
npm run check
npm test
npm run smoke
npm run smoke:device
npm audit --audit-level=high
npm pack --dry-run
```

`detect --json` and `setup --dry-run` must also complete without modifying any
client configuration.
