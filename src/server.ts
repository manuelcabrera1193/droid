import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AdbClient, SAFE_KEYS } from "./adb.js";
import { DeviceSelectionStore } from "./config.js";

const device = z.string().trim().min(1).max(256).optional().describe("ADB serial. Omit when exactly one device is ready.");
const coordinate = z.number().int().min(0).max(20_000);
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DEVICE_ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

function success(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Android operation error";
  return { isError: true, content: [{ type: "text" as const, text: message.slice(0, 2_000) }] };
}

function createDefaultAdbClient(): AdbClient {
  const selection = new DeviceSelectionStore();
  return new AdbClient({ defaultSerialProvider: () => selection.getSelectedSerial() });
}

export function createServer(client = createDefaultAdbClient()): McpServer {
  const server = new McpServer({ name: "local-android", version: "0.3.1" });

  server.registerTool(
    "android_list_devices",
    {
      title: "List Android devices",
      description: "List locally attached ADB devices and their authorization state. Read-only.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => {
      try {
        return jsonContent(await client.listDevices());
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_device_info",
    {
      title: "Inspect Android device",
      description: "Read a small allow-listed set of Android build and hardware properties.",
      annotations: READ_ONLY,
      inputSchema: { device },
    },
    async ({ device: selected }) => {
      try {
        return jsonContent(await client.getDeviceInfo(selected));
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_screenshot",
    {
      title: "Capture Android screen",
      description: "Capture the current screen as a PNG. Read-only.",
      annotations: READ_ONLY,
      inputSchema: { device },
    },
    async ({ device: selected }) => {
      try {
        const png = await client.screenshot(selected);
        return {
          content: [
            { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
            { type: "text" as const, text: `Captured ${png.length} PNG bytes` },
          ],
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_get_ui_tree",
    {
      title: "Read Android UI tree",
      description: "Return the current UIAutomator XML hierarchy for locating visible controls. Read-only.",
      annotations: READ_ONLY,
      inputSchema: { device },
    },
    async ({ device: selected }) => {
      try {
        return { content: [{ type: "text" as const, text: await client.getUiTree(selected) }] };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_tap",
    {
      title: "Tap Android screen",
      description: "Tap one screen coordinate on the selected Android device.",
      annotations: DEVICE_ACTION,
      inputSchema: { x: coordinate, y: coordinate, device },
    },
    async (input) => {
      try {
        await client.tap(input);
        return success(`Tapped (${input.x}, ${input.y})`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_swipe",
    {
      title: "Swipe Android screen",
      description: "Swipe between two coordinates with a bounded duration.",
      annotations: DEVICE_ACTION,
      inputSchema: {
        x1: coordinate,
        y1: coordinate,
        x2: coordinate,
        y2: coordinate,
        durationMs: z.number().int().min(50).max(5_000).default(300),
        device,
      },
    },
    async (input) => {
      try {
        await client.swipe(input);
        return success(`Swiped (${input.x1}, ${input.y1}) → (${input.x2}, ${input.y2})`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_type_text",
    {
      title: "Type safe text on Android",
      description:
        "Type text through ADB. For safety, only letters, digits, spaces, and @ . _ + - / : , are accepted.",
      annotations: DEVICE_ACTION,
      inputSchema: { text: z.string().min(1).max(2_000), device },
    },
    async (input) => {
      try {
        await client.typeText(input);
        return success(`Typed ${input.text.length} characters`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_press_key",
    {
      title: "Press safe Android key",
      description: "Press one allow-listed Android key; arbitrary key codes are not accepted.",
      annotations: DEVICE_ACTION,
      inputSchema: { key: z.enum(SAFE_KEYS), device },
    },
    async ({ key, device: selected }) => {
      try {
        await client.pressKey(key, selected);
        return success(`Pressed ${key}`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_list_packages",
    {
      title: "List Android packages",
      description: "List installed Android package identifiers. Read-only.",
      annotations: READ_ONLY,
      inputSchema: { thirdPartyOnly: z.boolean().default(true), device },
    },
    async (input) => {
      try {
        return jsonContent(await client.listPackages(input));
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_launch_app",
    {
      title: "Launch Android app",
      description: "Launch an installed package through its launcher activity.",
      annotations: DEVICE_ACTION,
      inputSchema: { packageName: z.string().min(3).max(255), device },
    },
    async (input) => {
      try {
        const output = await client.launchApp(input);
        return success(output || `Launched ${input.packageName}`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    "android_force_stop_app",
    {
      title: "Stop Android app",
      description: "Force-stop one installed package. This does not clear application data.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { packageName: z.string().min(3).max(255), device },
    },
    async (input) => {
      try {
        await client.forceStopApp(input);
        return success(`Stopped ${input.packageName}`);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  return server;
}
