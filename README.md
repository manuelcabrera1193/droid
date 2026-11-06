# Local Android MCP

A local-only, model-agnostic MCP server and installer that lets GitHub Copilot,
Codex, Claude, Cursor, Gemini, Devin/Windsurf, and other MCP clients operate an
Android device through ADB.

The server contains **no language model** and calls **no cloud API**. The MCP
client supplies the reasoning; this package supplies a deliberately constrained
Android tool surface.

## Requirements

- Node.js 20 or newer
- Android platform-tools (`adb`)
- An Android device with USB debugging enabled, or an authorized wireless ADB device

Confirm the device before setup:

```sh
adb devices -l
```

The device state must be `device`, not `unauthorized` or `offline`.

## Get the source

```sh
git clone https://github.com/manuelcabrera1193/droid.git
cd droid
npm ci
```

The GitHub repository is public. The npm package remains marked `private` to
prevent accidental registry publication; local installation is supported.

## One-command multi-client setup

Install a self-contained global copy, detect the AI clients on this computer,
review the plan, and apply it:

```sh
npm install
npm run install:global
local-android-mcp detect
local-android-mcp setup
local-android-mcp setup --yes --force
local-android-mcp doctor
local-android-mcp ui
```

`setup` without `--yes` is always a read-only plan. The applied setup:

- registers one stable `local-android-mcp` command, never the source folder;
- configures every detected compatible client;
- merges existing JSON/JSONC instead of replacing it;
- creates timestamped sibling backups before changes;
- uses vendor CLIs for Codex, Claude Code, and Devin;
- refuses malformed configuration and conflicting entries unless `--force` is explicit.

`--force` is required for Codex, Claude Code, and Devin because their official
CLI may replace an existing same-named entry and does not expose portable
installer ownership metadata. Always inspect the plan first.

Limit setup to selected clients when needed:

```sh
local-android-mcp setup --client vscode,cursor,codex
local-android-mcp setup --client vscode --yes
local-android-mcp uninstall --client vscode --yes
```

Uninstalling a provider-CLI-owned entry (`codex`, `claude-code`, or `devin`)
requires `--force` because those formats do not expose portable ownership
metadata. Inspect the plan and provider configuration first.

Supported IDs are `vscode`, `copilot`, `cursor`, `claude-code`,
`claude-desktop`, `codex`, `gemini`, `devin`, and `windsurf-legacy`.
Windows configurations use `cmd.exe` with the absolute npm shim dynamically
resolved during setup, preventing an untrusted workspace from shadowing the
command. macOS and Linux use the stable global command directly. Rerun setup
after moving to another computer or changing the Windows Node installation.

## Local device selector

Run:

```sh
local-android-mcp ui
```

The command starts an ephemeral web server bound only to `127.0.0.1`, opens the
default browser, and remains active until you press `Ctrl+C`. From the panel you
can select or clear the default device, inspect authorization state, refresh a
screenshot, and start a configured Android Virtual Device. The page refreshes
its inventory automatically.

The selected card exposes **Deseleccionar**, which removes the saved preference
and returns to automatic selection. If **Actualizar** cannot reach the local
service, keep the terminal that runs `local-android-mcp ui` open. With a fixed
port, restarting `local-android-mcp ui --port 3210` lets the same page renew its
local session on the next refresh.

The selection is read dynamically by the MCP server, so changing it does not
require editing every AI client. Selection precedence is:

1. the `device` argument supplied by an MCP tool;
2. `ANDROID_SERIAL` from the MCP client environment;
3. the device saved by the local web panel;
4. automatic selection when exactly one authorized device exists.

Use `local-android-mcp ui --no-open` on a headless machine, or `--port 3210`
when a predictable localhost port is useful. The UI exposes no LAN listener,
uses a per-process request token, and does not call a cloud service.

See [`docs/CLIENT-COMPATIBILITY.md`](docs/CLIENT-COMPATIBILITY.md) for exact
destinations and [`docs/AI-INTEGRATION.md`](docs/AI-INTEGRATION.md) for a guide
written for both developers and coding agents.

For a new computer, follow [`docs/INSTALL-MAC-WINDOWS.md`](docs/INSTALL-MAC-WINDOWS.md).

## Workspace-only setup (GitHub Copilot)

```sh
npm install
npm test
npm run smoke
npm run smoke:device
```

The repository-root [`.mcp.json`](.mcp.json) is portable. It runs `npm` in the
workspace instead of containing an absolute path, so the whole folder can be
moved or copied to another computer. On the other computer, install Node.js and
ADB, run `npm install`, and open the folder in VS Code.

In VS Code:

1. Open this folder as the workspace.
2. Open the Command Palette and run **MCP: List Servers**.
3. Start or restart `local-android` if it is not already running.
4. In Copilot Agent mode, ask: `List the connected Android devices using local-android.`

GitHub Copilot's portable workspace format uses `mcpServers`; the older
`.vscode/mcp.json` format uses a different top-level key and is intentionally
not duplicated here.

## Global, source-location-independent installation

To use the server from unrelated workspaces, install a packaged copy:

```sh
npm install
npm run install:global
```

This builds an npm tarball and installs a copy globally. Moving or deleting the
source folder afterward does not break the `local-android-mcp` command. The
automatic `setup` command is recommended; [`examples/global-mcp.json`](examples/global-mcp.json)
remains available for manual clients.

Common destinations:

- GitHub Copilot CLI: `$COPILOT_HOME/mcp-config.json`, or `~/.copilot/mcp-config.json`
- Codex: `$CODEX_HOME/config.toml`, or `~/.codex/config.toml`
- Claude Code: `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json`
- A compatible workspace: `.mcp.json`
- Claude Desktop: its `mcpServers` configuration

Do not overwrite an existing global configuration file; merge only the
`local-android` entry.

## Dynamic ADB and device selection

The server resolves ADB in this order:

1. `ANDROID_ADB_PATH`
2. `ADB_PATH`
3. `ANDROID_SDK_ROOT/platform-tools/adb`
4. `ANDROID_HOME/platform-tools/adb`
5. `adb` found on `PATH`

No repository, SDK, home-directory, or device path is hard-coded.

When exactly one authorized device exists, it is selected automatically. With
multiple devices, pass `device` to a tool or set `ANDROID_SERIAL` before the MCP
client starts.

Examples:

```sh
export ANDROID_SERIAL=emulator-5554
export ANDROID_ADB_PATH=/custom/android-sdk/platform-tools/adb
```

These variables are optional. Keep machine-specific values outside committed
MCP configuration.

The UI also resolves the Android Emulator through `ANDROID_EMULATOR_PATH`,
`EMULATOR_PATH`, the active Android SDK, and finally `PATH`.

## Exposed tools

| Tool | Effect |
| --- | --- |
| `android_list_devices` | List attached devices and authorization state |
| `android_device_info` | Read an allow-listed subset of build properties |
| `android_screenshot` | Return the current screen as PNG |
| `android_get_ui_tree` | Return the UIAutomator XML hierarchy |
| `android_tap` | Tap a bounded coordinate |
| `android_swipe` | Swipe between bounded coordinates |
| `android_type_text` | Type a conservative, shell-safe character set |
| `android_press_key` | Press an allow-listed navigation key |
| `android_list_packages` | List package identifiers |
| `android_launch_app` | Launch a validated package identifier |
| `android_force_stop_app` | Stop an app without deleting its data |

## Security boundaries

- Commands use process argument arrays with local shell execution disabled.
- There is no arbitrary `adb shell` tool.
- Package names, coordinates, durations, keys, and text are validated.
- Text containing shell metacharacters is rejected before reaching the device.
- Commands have timeouts and output-size limits.
- There are no install, uninstall, clear-data, reboot, file-transfer, or root tools.
- MCP runs over local stdio and opens no listening network port.

ADB itself is a privileged debugging interface. Use a dedicated test device and
review tool approvals in the MCP client.

Do not commit device screenshots, UI dumps, private design links, device
identifiers, credentials, or signing keys. The repository excludes common local
artifacts, and CI scans the Git history with Gitleaks. Test fixtures use synthetic
device names and documentation-only network addresses.

## Development and verification

```sh
npm run check         # TypeScript without output
npm test              # Build plus unit tests
npm run smoke         # Start a real MCP client/server session and list devices
npm run smoke:device  # Read device info, screenshot, and UI tree
npm pack --dry-run    # Inspect the portable package contents
local-android-mcp detect --json
local-android-mcp setup --dry-run
```

The unit tests cover portable ADB discovery, device parsing and selection,
argument construction, client detection, JSONC-preserving configuration merges,
backup/conflict behavior, package validation, and remote-shell text rejection.

## Documentation map

- [`AGENTS.md`](AGENTS.md): repository rules and implementation map for coding agents.
- [`llms.txt`](llms.txt): compact discovery entrypoint for language models.
- [`docs/AI-INTEGRATION.md`](docs/AI-INTEGRATION.md): implementation and project-integration contract.
- [`docs/CLIENT-COMPATIBILITY.md`](docs/CLIENT-COMPATIBILITY.md): supported clients and configuration ownership.
- [`docs/INSTALL-MAC-WINDOWS.md`](docs/INSTALL-MAC-WINDOWS.md): portable setup on another macOS or Windows computer.
- [`docs/local-android.manifest.json`](docs/local-android.manifest.json): machine-readable capability manifest.
