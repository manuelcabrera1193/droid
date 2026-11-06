# Install on another macOS or Windows computer

The recommended transfer artifact is `local-android-mcp-0.3.1.tgz`. It contains
the compiled server, CLI, UI, and documentation. It does not contain a model,
credentials, an Android SDK, or machine-specific paths.

## Prerequisites on every computer

1. Install Node.js 20 or newer.
2. Install Android Studio or Android SDK Platform-Tools.
3. Enable USB debugging on the physical device, or create an AVD in Android Studio.
4. Confirm that `adb devices -l` reports the intended device as `device`.

## macOS

Copy the `.tgz` file to the Mac, open Terminal in that directory, and run:

```sh
npm install --global ./local-android-mcp-0.3.1.tgz
local-android-mcp detect
local-android-mcp setup
local-android-mcp setup --yes --force
local-android-mcp doctor
local-android-mcp ui
```

If `adb` is not on `PATH`, point to the SDK for that terminal or configure the
MCP client environment:

```sh
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
```

Do not copy this value from another user account; derive it on the destination Mac.

## Windows

Install Node.js and Android Studio, then copy the `.tgz` file to the PC. Open
PowerShell in that directory and run:

```powershell
npm install --global .\local-android-mcp-0.3.1.tgz
local-android-mcp detect
local-android-mcp setup
local-android-mcp setup --yes --force
local-android-mcp doctor
local-android-mcp ui
```

If PowerShell cannot find `adb.exe`, set the current user's Android SDK variable
to the SDK location shown by Android Studio, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable(
  "ANDROID_SDK_ROOT",
  "$env:LOCALAPPDATA\Android\Sdk",
  "User"
)
```

If PowerShell cannot find the global CLI, run `npm prefix --global`, add that
directory to the user `Path`, and open a new terminal. Verify with:

```powershell
Get-Command local-android-mcp
Get-Command adb
```

## Source-folder alternative

If transferring the whole repository instead of the `.tgz`, run these inside it:

```sh
npm install
npm run install:global
```

Then continue with `detect`, `setup`, `doctor`, and `ui`. The global installation
is a packaged copy, so moving the source folder later does not break configured
clients.

You can also obtain the source directly from GitHub on either platform:

```sh
git clone https://github.com/manuelcabrera1193/droid.git
cd droid
npm ci
npm run install:global
```

## Device selection behavior

Open the selector whenever you connect multiple devices:

```sh
local-android-mcp ui
```

The saved preference belongs to the destination computer and user. It is not
embedded in the package and should not be copied between machines. A prompt may
still override it by naming a `device` serial, and `ANDROID_SERIAL` overrides the
saved preference for the MCP process that receives that environment variable.
