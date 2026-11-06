import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { AdbClient, type AndroidDevice, validateDeviceSerial } from "./adb.js";
import { DeviceSelectionStore } from "./config.js";
import { EmulatorManager } from "./emulator.js";

export interface DeviceUiAdb {
  readonly adbCommand: string;
  listDevices(): Promise<AndroidDevice[]>;
  screenshot(device?: string): Promise<Buffer>;
}

export interface DeviceUiEmulators {
  readonly command: string;
  listAvds(): Promise<string[]>;
  startAvd(name: string): Promise<void>;
}

export interface DeviceUiHandle {
  url: string;
  close(): Promise<void>;
}

interface StartDeviceUiOptions {
  port?: number;
  adb?: DeviceUiAdb;
  emulators?: DeviceUiEmulators;
  selection?: DeviceSelectionStore;
  token?: string;
}

const HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Selector local de dispositivos Android para clientes MCP.">
  <title>Local Android</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">LOCAL ANDROID MCP</p>
        <h1>Seleccionar dispositivo</h1>
        <p class="subtitle">Elige el Android que usarán Copilot, Codex y tus demás clientes MCP.</p>
      </div>
      <div class="actions"><button id="automatic" class="secondary" type="button">Usar selección automática</button><button id="refresh" class="secondary" type="button">Actualizar</button></div>
    </header>

    <div id="notice" class="notice" role="status" aria-live="polite"></div>

    <section class="panel" aria-labelledby="devices-title">
      <div class="section-heading">
        <div><p class="kicker">ADB</p><h2 id="devices-title">Dispositivos conectados</h2></div>
        <span id="device-count" class="count">0</span>
      </div>
      <div id="devices" class="device-grid"></div>
    </section>

    <section class="split">
      <div class="panel">
        <div class="section-heading"><div><p class="kicker">VISTA PREVIA</p><h2>Pantalla actual</h2></div></div>
        <div class="preview"><img id="screenshot" alt="Captura del dispositivo seleccionado" hidden><p id="preview-empty">Selecciona un dispositivo disponible.</p></div>
      </div>
      <div class="panel">
        <div class="section-heading"><div><p class="kicker">AVD</p><h2>Emuladores disponibles</h2></div></div>
        <div id="avds" class="stack"></div>
      </div>
    </section>

    <section class="panel diagnostic" aria-labelledby="diagnostic-title">
      <div><p class="kicker">DIAGNÓSTICO</p><h2 id="diagnostic-title">Configuración local</h2></div>
      <dl><div><dt>ADB</dt><dd id="adb-command">—</dd></div><div><dt>Emulator</dt><dd id="emulator-command">—</dd></div><div><dt>Preferencia</dt><dd id="config-path">—</dd></div></dl>
    </section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;

const CSS = `:root{color-scheme:dark;--bg:#090b10;--panel:#121621;--line:#282e3d;--text:#f7f8fb;--muted:#9ca6b8;--accent:#6245e8;--good:#4bd6a1;--warn:#ffb454;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% -10%,#30245e 0,transparent 32%),var(--bg);color:var(--text)}button{font:inherit}.shell{width:min(1100px,calc(100% - 32px));margin:auto;padding:48px 0 72px}.hero,.section-heading,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.hero{margin-bottom:24px}.eyebrow,.kicker{margin:0 0 8px;color:#a995ff;font-size:.72rem;font-weight:800;letter-spacing:.16em}.kicker{color:var(--muted)}h1,h2,p{margin-top:0}h1{margin-bottom:8px;font-size:clamp(2rem,5vw,3.8rem);line-height:1}.subtitle{max-width:650px;margin-bottom:0;color:var(--muted)}h2{margin-bottom:0;font-size:1.2rem}.panel{margin-top:18px;padding:22px;border:1px solid var(--line);border-radius:20px;background:color-mix(in srgb,var(--panel) 94%,transparent);box-shadow:0 20px 60px #0005}.secondary,.select,.launch{border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:#1a2030;color:var(--text);cursor:pointer}.secondary:hover,.select:hover,.launch:hover{border-color:#7565bc}.secondary:focus-visible,.select:focus-visible,.launch:focus-visible{outline:3px solid #8f7aff;outline-offset:2px}.secondary:disabled,.select:disabled,.launch:disabled{cursor:not-allowed;opacity:.45}.count{display:grid;min-width:34px;height:34px;place-items:center;border-radius:999px;background:#23283a;color:#c9d0dd}.device-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:18px}.device-card,.avd{padding:16px;border:1px solid var(--line);border-radius:16px;background:#0d1018}.device-card.selected{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.card-top,.avd{display:flex;align-items:center;justify-content:space-between;gap:12px}.device-name{font-weight:750}.serial{margin:7px 0 14px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem;overflow-wrap:anywhere}.status{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:.82rem}.dot{width:8px;height:8px;border-radius:50%;background:var(--warn)}.ready .dot{background:var(--good);box-shadow:0 0 12px #4bd6a177}.select[aria-pressed=true]{background:var(--accent);border-color:var(--accent)}.split{display:grid;grid-template-columns:1.25fr .75fr;gap:18px}.preview{display:grid;min-height:330px;margin-top:18px;place-items:center;overflow:hidden;border:1px dashed var(--line);border-radius:16px;background:#080a0f;color:var(--muted)}.preview img{display:block;max-width:100%;max-height:520px;object-fit:contain}.stack{display:grid;gap:10px;margin-top:18px}.avd span{overflow-wrap:anywhere}.notice{min-height:24px;color:var(--muted)}.notice.error{color:#ff8e9c}.notice.success{color:var(--good)}.diagnostic dl{display:grid;gap:12px;margin:20px 0 0}.diagnostic dl div{display:grid;grid-template-columns:110px 1fr;gap:12px}.diagnostic dt{color:var(--muted)}.diagnostic dd{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.82rem;overflow-wrap:anywhere}@media(max-width:760px){.shell{width:min(100% - 20px,1100px);padding-top:28px}.hero{align-items:flex-start;flex-direction:column}.actions{flex-wrap:wrap}.split{grid-template-columns:1fr}.panel{padding:17px}.diagnostic dl div{grid-template-columns:1fr;gap:3px}}@media(prefers-reduced-motion:no-preference){.panel{animation:rise .35s ease both}@keyframes rise{from{opacity:0;transform:translateY(8px)}}}`;

const JAVASCRIPT = `
const $ = (id) => document.getElementById(id);
let token = "";
let selected = "";
let lastInventory = "";
let previewKey = "";
let previewObjectUrl = "";
let previewGeneration = 0;

const notice = (message, type = "") => {
  const node = $("notice");
  node.textContent = message;
  node.className = "notice " + type;
};

const authorizedFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (token && path.startsWith("/api/")) headers.set("x-local-android-token", token);
  return await fetch(path, { ...options, headers });
};

const errorMessage = (error) => error instanceof Error
  ? error.message
  : "La operación falló";

const request = async (path, options = {}) => {
  let response;
  try {
    response = await authorizedFetch(path, options);
  } catch {
    throw new Error("No se pudo conectar al servicio local. Ejecuta local-android-mcp ui y mantén abierta esa terminal.");
  }
  const body = await response.json().catch(() => ({ error: "Respuesta inválida" }));
  if (!response.ok) throw new Error(body.error || "La operación falló");
  return body;
};

const post = async (path, value) => request(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const focusKey = () => document.activeElement?.dataset?.focusKey || "";
const restoreFocus = (key) => {
  if (!key) return;
  const target = [...document.querySelectorAll("[data-focus-key]")]
    .find((node) => node.dataset.focusKey === key);
  target?.focus();
};

function renderDevices(state) {
  const root = $("devices");
  root.replaceChildren();
  $("device-count").textContent = String(state.devices.length);
  if (!state.devices.length) {
    root.append(el("p", "serial", "No hay dispositivos ADB conectados."));
    return;
  }
  for (const device of state.devices) {
    const ready = device.state === "device";
    const active = device.serial === state.selectedDevice;
    const label = device.model || device.product || "Android";
    const card = el("article", "device-card" + (active ? " selected" : ""));
    const top = el("div", "card-top");
    const labels = el("div");
    labels.append(el("div", "device-name", label));
    const status = el("span", "status" + (ready ? " ready" : ""));
    status.append(el("i", "dot"), document.createTextNode(device.state));
    top.append(labels, status);
    const serial = el("p", "serial", device.serial);
    const button = el("button", "select", active ? "Deseleccionar" : "Usar este");
    button.type = "button";
    button.disabled = !ready;
    button.dataset.focusKey = "device:" + device.serial;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", (active ? "Deseleccionar " : "Usar ") + label + ", " + device.serial);
    button.addEventListener("click", () => active ? automatic() : choose(device.serial));
    card.append(top, serial, button);
    root.append(card);
  }
}

function renderAvds(state) {
  const root = $("avds");
  root.replaceChildren();
  if (state.avdError) {
    root.append(el("p", "serial", state.avdError));
    return;
  }
  if (!state.avds.length) {
    root.append(el("p", "serial", "No hay AVDs configurados."));
    return;
  }
  for (const name of state.avds) {
    const row = el("div", "avd");
    row.append(el("span", "", name));
    const button = el("button", "launch", "Iniciar");
    button.type = "button";
    button.dataset.focusKey = "avd:" + name;
    button.setAttribute("aria-label", "Iniciar " + name);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await post("/api/emulators/start", { name });
        notice("Emulador iniciado. Aparecerá cuando ADB lo reporte.", "success");
        setTimeout(() => load({ refreshPreview: true }), 2500);
      } catch (error) {
        notice(errorMessage(error), "error");
      } finally {
        button.disabled = false;
      }
    });
    row.append(button);
    root.append(row);
  }
}

async function updatePreview(state, force = false) {
  const image = $("screenshot");
  const empty = $("preview-empty");
  const ready = state.devices.filter((device) => device.state === "device");
  const previewSerial = selected || (ready.length === 1 ? ready[0].serial : "");
  if (!previewSerial) {
    previewGeneration += 1;
    previewKey = "";
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
    image.removeAttribute("src");
    image.hidden = true;
    empty.hidden = false;
    empty.textContent = "Selecciona un dispositivo disponible.";
    return;
  }
  if (!force && previewKey === previewSerial) return;
  const generation = ++previewGeneration;
  previewKey = previewSerial;
  try {
    const response = await authorizedFetch("/api/screenshot?device=" + encodeURIComponent(previewSerial));
    if (!response.ok) throw new Error("screenshot failed");
    const nextUrl = URL.createObjectURL(await response.blob());
    if (generation !== previewGeneration) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = nextUrl;
    image.src = nextUrl;
    image.hidden = false;
    empty.hidden = true;
  } catch {
    if (generation !== previewGeneration) return;
    previewKey = "";
    image.hidden = true;
    empty.hidden = false;
    empty.textContent = "No se pudo obtener la captura.";
  }
}

async function choose(serial) {
  try {
    await post("/api/selection", { serial });
    selected = serial;
    notice("Dispositivo predeterminado guardado.", "success");
    await load({ refreshPreview: true });
  } catch (error) {
    notice(errorMessage(error), "error");
  }
}

async function automatic() {
  try {
    await post("/api/selection", { serial: null });
    selected = "";
    notice("Selección automática activada.", "success");
    await load({ refreshPreview: true });
  } catch (error) {
    notice(errorMessage(error), "error");
  }
}

async function load({ refreshPreview = false } = {}) {
  try {
    const state = await request("/api/state");
    selected = state.selectedDevice || "";
    const inventory = JSON.stringify({ devices: state.devices, avds: state.avds, avdError: state.avdError, selected });
    if (inventory !== lastInventory) {
      const previousFocus = focusKey();
      renderDevices(state);
      renderAvds(state);
      restoreFocus(previousFocus);
      lastInventory = inventory;
    }
    $("adb-command").textContent = state.adbCommand;
    $("emulator-command").textContent = state.emulatorCommand;
    $("config-path").textContent = state.configPath;
    await updatePreview(state, refreshPreview);
    return true;
  } catch (error) {
    notice(errorMessage(error), "error");
    return false;
  }
}

async function reconnect() {
  const button = $("refresh");
  button.disabled = true;
  notice("Actualizando conexión local…");
  try {
    token = "";
    token = (await request("/api/session")).token;
    lastInventory = "";
    if (await load({ refreshPreview: true })) {
      notice("Información actualizada.", "success");
    }
  } catch (error) {
    notice(errorMessage(error), "error");
  } finally {
    button.disabled = false;
  }
}

async function init() {
  try {
    token = (await request("/api/session")).token;
    await load({ refreshPreview: true });
    setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
  } catch (error) {
    notice(errorMessage(error), "error");
  }
}

$("refresh").addEventListener("click", reconnect);
$("automatic").addEventListener("click", automatic);
init();
`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7c5cff"/><path d="M19 25h26v21a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V25Zm5-9 4 6m12-6-4 6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="27" cy="33" r="2" fill="#fff"/><circle cx="37" cy="33" r="2" fill="#fff"/></svg>`;

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function send(response: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 4096) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}

function safeTokenEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function startDeviceUi(options: StartDeviceUiOptions = {}): Promise<DeviceUiHandle> {
  const adb = options.adb ?? new AdbClient();
  const emulators = options.emulators ?? new EmulatorManager();
  const selection = options.selection ?? new DeviceSelectionStore();
  const token = options.token ?? randomBytes(32).toString("hex");
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("UI port must be an integer from 0 to 65535");

  let url = "";
  let allowedHost = "";
  let activeDeviceOperations = 0;
  const withDeviceSlot = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (activeDeviceOperations >= 2) throw new Error("Too many concurrent local device operations");
    activeDeviceOperations += 1;
    try {
      return await operation();
    } finally {
      activeDeviceOperations -= 1;
    }
  };
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      if (request.headers.host !== allowedHost) {
        sendJson(response, 403, { error: "Invalid local Host header" });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", url);
      if (request.method === "GET" && requestUrl.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", HTML);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/styles.css") {
        send(response, 200, "text/css; charset=utf-8", CSS);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/app.js") {
        send(response, 200, "text/javascript; charset=utf-8", JAVASCRIPT);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/favicon.svg") {
        send(response, 200, "image/svg+xml; charset=utf-8", FAVICON);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/session") {
        sendJson(response, 200, { token });
        return;
      }
      const tokenHeader = request.headers["x-local-android-token"];
      const hasValidToken = safeTokenEqual(typeof tokenHeader === "string" ? tokenHeader : undefined, token);
      if (request.method === "GET" && requestUrl.pathname === "/api/state") {
        if (!hasValidToken) {
          sendJson(response, 403, { error: "Invalid local request token" });
          return;
        }
        const [devices, avdResult] = await withDeviceSlot(async () => await Promise.all([
          adb.listDevices(),
          emulators.listAvds().then((avds) => ({ avds })).catch((error: unknown) => ({ avds: [], avdError: error instanceof Error ? error.message : "Emulator unavailable" })),
        ]));
        sendJson(response, 200, {
          devices,
          selectedDevice: selection.getSelectedSerial(),
          adbCommand: adb.adbCommand,
          emulatorCommand: emulators.command,
          configPath: selection.configPath,
          ...avdResult,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/screenshot") {
        if (!hasValidToken) {
          sendJson(response, 403, { error: "Invalid local request token" });
          return;
        }
        const serial = validateDeviceSerial(requestUrl.searchParams.get("device") ?? "");
        const screenshot = await withDeviceSlot(async () => {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === serial && device.state === "device")) return undefined;
          return await adb.screenshot(serial);
        });
        if (!screenshot) {
          sendJson(response, 409, { error: "The selected Android device is not ready" });
          return;
        }
        send(response, 200, "image/png", screenshot);
        return;
      }

      const mutating = requestUrl.pathname === "/api/selection" || requestUrl.pathname === "/api/emulators/start";
      if (mutating && request.method === "POST") {
        if (request.headers.origin !== url || !hasValidToken) {
          sendJson(response, 403, { error: "Invalid local request token" });
          return;
        }
        const body = await readJson(request);
        if (requestUrl.pathname === "/api/selection") {
          if (body.serial === null) {
            await selection.setSelectedSerial(undefined);
            sendJson(response, 200, { selectedDevice: null });
            return;
          }
          if (typeof body.serial !== "string") throw new Error("serial must be a string or null");
          const serial = validateDeviceSerial(body.serial);
          const devices = await withDeviceSlot(async () => await adb.listDevices());
          if (!devices.some((device) => device.serial === serial && device.state === "device")) {
            sendJson(response, 409, { error: "Only an attached and authorized device can be selected" });
            return;
          }
          await selection.setSelectedSerial(serial);
          sendJson(response, 200, { selectedDevice: serial });
          return;
        }
        if (typeof body.name !== "string") throw new Error("name must be a string");
        await withDeviceSlot(async () => await emulators.startAvd(body.name as string));
        sendJson(response, 202, { started: body.name });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message.slice(0, 1000) : "Invalid request" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  allowedHost = `127.0.0.1:${address.port}`;
  url = `http://${allowedHost}`;
  return {
    url,
    close: async () => await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export function buildOpenInvocation(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(url)) throw new Error("Refusing to open a non-local URL");
  return platform === "darwin"
    ? { command: "open", args: [url] }
    : platform === "win32"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : { command: "xdg-open", args: [url] };
}

export function openLocalUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  const invocation = buildOpenInvocation(url, platform);
  const child = spawn(invocation.command, invocation.args, { detached: true, shell: false, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
