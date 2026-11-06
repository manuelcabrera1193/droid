# Client compatibility

The installer derives every location from the current OS and environment. Paths
below use `~` only as documentation shorthand; no home path is compiled in.

| Client ID | Detection | Configuration strategy | User destination |
| --- | --- | --- | --- |
| `vscode` | `code`, app bundle, or existing config | JSONC merge (`servers`, `type: stdio`) | OS-specific VS Code `User/mcp.json` |
| `copilot` | `copilot`, `COPILOT_HOME`, or existing config | JSONC merge (`mcpServers`) | `$COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json` |
| `cursor` | `cursor`, `cursor-agent`, app, or `~/.cursor` | JSONC merge (`mcpServers`) | `~/.cursor/mcp.json` |
| `claude-code` | `claude`, configured directory, or existing config | `claude mcp add --scope user` | `$CLAUDE_CONFIG_DIR/.claude.json` or `~/.claude.json` |
| `claude-desktop` | Claude app or existing config | compatible local-stdio JSONC merge | OS-specific `Claude/claude_desktop_config.json` |
| `codex` | `codex`, app, or configured home | `codex mcp add` | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| `gemini` | `gemini` or `~/.gemini` | JSONC merge (`mcpServers`) | `~/.gemini/settings.json` |
| `devin` | `devin`, app, or current config | `devin mcp add -s user` | Managed by Devin |
| `windsurf-legacy` | legacy app/config | legacy JSONC merge | `~/.codeium/windsurf/mcp_config.json` |

Current Devin installations supersede the legacy Windsurf target, so the
installer skips the legacy target when Devin is also detected.

## Platform rules

- macOS user application data: `~/Library/Application Support`
- Linux user application data: `$XDG_CONFIG_HOME`, falling back to `~/.config`
- Windows user application data: `%APPDATA%`, falling back below the user profile
- Copilot honors `COPILOT_HOME`
- Codex honors `CODEX_HOME`
- Claude Code honors `CLAUDE_CONFIG_DIR`
- Windows resolves the absolute global npm shim at setup time and invokes it
  through `cmd.exe /d /s /c call`, preventing workspace command shadowing
- Unix-like systems invoke the stable global command directly

## Operational rules

- Detection alone never creates files.
- A normal setup command is a plan; `--yes` is required to write.
- Existing configuration is backed up before modification.
- Invalid JSON/JSONC is never replaced.
- An existing different `local-android` entry requires review and `--force`.
- Uninstall removes only a matching `local-android` entry; conflicts and
  provider-CLI-owned entries require explicit `--force`.

Vendor formats evolve. Run `local-android-mcp detect --json` and
`local-android-mcp setup --dry-run` after upgrading a client.
