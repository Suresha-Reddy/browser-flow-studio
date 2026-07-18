import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { readdir, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load as parseYaml, dump as dumpYaml } from "js-yaml";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let recorder = null;
let flowTest = null;
const dirs = {
  drafts: path.join(root, "flows", "drafts"),
  published: path.join(root, "flows", "published"),
  recordings: path.join(root, "recordings"),
  exports: path.join(root, "exports"),
  privateData: path.join(root, "test-data", "private"),
};
async function ensure() {
  await Promise.all(
    Object.values(dirs).map((x) => mkdir(x, { recursive: true })),
  );
}
async function parseFile(file) {
  const raw = await readFile(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
}
async function flowFiles() {
  const out = [];
  for (const [status, dir] of [
    ["draft", dirs.drafts],
    ["published", dirs.published],
  ]) {
    for (const name of await readdir(dir).catch(() => [])) {
      if (!/\.(ya?ml|json)$/.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const d = await parseFile(file);
        out.push({
          file,
          name,
          status,
          key: d.application?.key ?? name,
          title: d.application?.name ?? name,
          portal: d.application?.portal ?? "",
          version: d.application?.version ?? 1,
          states: Object.keys(d.flow?.states ?? {}).length,
        });
      } catch {}
    }
  }
  return out.sort(
    (a, b) => a.title.localeCompare(b.title) || b.version - a.version,
  );
}
function buildWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Flow Studio",
    backgroundColor: "#f7f7f5",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(here, "app", "index.html"));
}
app.whenReady().then(async () => {
  await ensure();
  buildWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) buildWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.handle("flows:list", flowFiles);
ipcMain.handle("flows:load", async (_e, file) => ({
  file,
  definition: await parseFile(file),
}));
ipcMain.handle("flows:create", async (_e, input) => {
  const key = String(input.key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const file = path.join(dirs.drafts, `${key}.v1.yaml`);
  const d = {
    schemaVersion: 1,
    application: {
      key,
      name: input.name,
      portal: input.portal || "replace_me",
      version: 1,
      entryUrl: input.entryUrl || "https://example.com",
    },
    fields: [],
    documents: [],
    flow: {
      initialState: "start",
      entryStates: ["start"],
      terminalStates: ["completed", "cancelled", "submission_unknown"],
      states: {
        start: {
          description: "First recorded page",
          resumable: true,
          replayPolicy: "detect_and_continue",
          detect: {
            urlContains: [
              new URL(input.entryUrl || "https://example.com").pathname,
            ],
          },
          steps: [],
          transitions: { success: "completed", unknown: "manual_review" },
        },
        manual_review: {
          description: "Resolve an unexpected page manually",
          resumable: false,
          replayPolicy: "manual_only",
          detect: { visibleText: ["replace_me"] },
          steps: [
            {
              id: "manual_review",
              type: "human_input",
              reason: "other",
              prompt: "Resolve the page manually, then continue.",
            },
          ],
          transitions: { success: "start" },
        },
      },
    },
  };
  await writeFile(file, dumpYaml(d, { noRefs: true, lineWidth: 120 }));
  return { file, definition: d };
});
ipcMain.handle("flows:save", async (_e, { file, definition }) => {
  if (path.resolve(file).startsWith(path.resolve(dirs.published)))
    throw new Error(
      "Published versions are immutable. Create a new version to edit.",
    );
  await writeFile(
    file,
    file.endsWith(".json")
      ? JSON.stringify(definition, null, 2)
      : dumpYaml(definition, { noRefs: true, lineWidth: 120 }),
  );
  return true;
});
ipcMain.handle("flows:newVersion", async (_e, file) => {
  const d = await parseFile(file);
  let version = Number(d.application.version) + 1,
    out;
  do {
    out = path.join(dirs.drafts, `${d.application.key}.v${version}.yaml`);
    try {
      await stat(out);
      version++;
    } catch {
      break;
    }
  } while (true);
  d.application.version = version;
  await writeFile(out, dumpYaml(d, { noRefs: true, lineWidth: 120 }));
  return { file: out, definition: d, status: "draft" };
});
ipcMain.handle("flows:validate", async (_e, file) => {
  const { validateFile } = await import(
    pathToFileURL(path.join(root, "dist", "validator", "validate.js"))
  );
  return validateFile(file);
});
ipcMain.handle("flows:publish", async (_e, file) => {
  const { publishFlow } = await import(
    pathToFileURL(path.join(root, "dist", "publisher", "publish.js"))
  );
  return publishFlow(file);
});
ipcMain.handle("flows:export", async (_e, { file, output }) => {
  const { generatePortablePackage } = await import(
    pathToFileURL(path.join(root, "dist", "generator", "codegen.js"))
  );
  const dir = await generatePortablePackage(file, output || undefined);
  shell.showItemInFolder(dir);
  return dir;
});
ipcMain.handle("record:start", async (_e, input) => {
  if (recorder) throw new Error("A recording is already running");
  const url = typeof input === "string" ? input : input.url,
    captureValues = typeof input === "object" && input.captureValues === true,
    args = [
      path.join(root, "dist", "cli.js"),
      "record",
      url,
      ...(captureValues ? ["--capture-values"] : []),
    ];
  recorder = spawn("node", args, {
    cwd: root,
    env: process.env,
    detached: process.platform !== "win32",
  });
  recorder.stdout.on("data", (d) =>
    BrowserWindow.getAllWindows()[0]?.webContents.send(
      "record:event",
      d.toString(),
    ),
  );
  recorder.stderr.on("data", (d) =>
    BrowserWindow.getAllWindows()[0]?.webContents.send(
      "record:event",
      d.toString(),
    ),
  );
  recorder.on("exit", () => {
    recorder = null;
    BrowserWindow.getAllWindows()[0]?.webContents.send("record:stopped");
  });
  return true;
});
ipcMain.handle("record:stop", async () => {
  const child = recorder;
  if (!child) return true;
  await new Promise((resolve) => {
    const finish = () => resolve(true);
    child.once("exit", finish);
    try {
      if (process.platform !== "win32" && child.pid)
        process.kill(-child.pid, "SIGINT");
      else child.kill("SIGINT");
    } catch {
      child.kill("SIGINT");
    }
    setTimeout(() => {
      if (recorder === child) {
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {}
      }
    }, 5000);
  });
  return true;
});
ipcMain.handle("record:latest", async () => {
  const names = await readdir(dirs.recordings).catch(() => []),
    rows = [];
  for (const name of names) {
    const file = path.join(dirs.recordings, name, "events.jsonl");
    try {
      const info = await stat(file);
      if (info.isFile() && info.size > 0)
        rows.push({ file, time: info.mtimeMs });
    } catch {}
  }
  rows.sort((a, b) => b.time - a.time);
  return rows[0]?.file ?? null;
});
ipcMain.handle("record:generate", async (_e, { eventsFile, output, key }) => {
  let info;
  try {
    info = await stat(eventsFile);
  } catch {
    throw new Error(
      "No recorded steps were found. Start recording, interact with the portal, then press Stop before generating the draft.",
    );
  }
  if (!info.isFile() || info.size === 0)
    throw new Error(
      "The recording contains no steps. Interact with at least one page control, then stop the recording.",
    );
  const { generateDraft } = await import(
    pathToFileURL(path.join(root, "dist", "generator", "generateDraft.js"))
  );
  await generateDraft(eventsFile, output, key);
  return output;
});
ipcMain.handle("dialog:directory", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("path:reveal", async (_e, p) => {
  shell.showItemInFolder(p);
  return true;
});

ipcMain.handle("dialog:file", async (_e, { acceptedTypes, multiple } = {}) => {
  const filters = acceptedTypes?.length
    ? [
        {
          name: "Allowed documents",
          extensions: [
            ...new Set(
              acceptedTypes
                .map((x) => x.split("/").pop())
                .filter((x) => x && x !== "octet-stream"),
            ),
          ],
        },
      ]
    : undefined;
  const r = await dialog.showOpenDialog({
    properties: ["openFile", ...(multiple ? ["multiSelections"] : [])],
    filters,
  });
  return r.canceled ? null : multiple ? r.filePaths : r.filePaths[0];
});
ipcMain.handle("documents:saveMap", async (_e, { flowKey, documents }) => {
  const file = path.join(dirs.privateData, `${flowKey}.documents.json`);
  await mkdir(dirs.privateData, { recursive: true });
  const payload = {
    ...Object.fromEntries(
      Object.entries(documents).map(([k, v]) => [`document.${k}`, v]),
    ),
    documents,
  };
  await writeFile(file, JSON.stringify(payload, null, 2));
  return file;
});

ipcMain.handle("testdata:load", async (_e, flowKey) => {
  const inputFile = path.join(dirs.privateData, `${flowKey}.input.json`);
  const documentFile = path.join(dirs.privateData, `${flowKey}.documents.json`);
  const readJson = async (file) => {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return {};
    }
  };
  const [savedInput, savedDocuments] = await Promise.all([
    readJson(inputFile),
    readJson(documentFile),
  ]);
  return {
    input: Object.fromEntries(
      Object.entries(savedInput).filter(
        ([key]) => !key.startsWith("document."),
      ),
    ),
    documents: savedDocuments.documents ?? {},
  };
});

ipcMain.handle(
  "testdata:save",
  async (_e, { flowKey, input = {}, documents = {} }) => {
    await mkdir(dirs.privateData, { recursive: true });
    const file = path.join(dirs.privateData, `${flowKey}.input.json`);
    const payload = {
      ...input,
      ...Object.fromEntries(
        Object.entries(documents).map(([key, value]) => [
          `document.${key}`,
          value,
        ]),
      ),
    };
    await writeFile(file, JSON.stringify(payload, null, 2));
    return file;
  },
);

ipcMain.handle("flowtest:start", async (_e, { file, flowKey }) => {
  if (flowTest) throw new Error("A browser test is already running");
  const dataFile = path.join(dirs.privateData, `${flowKey}.input.json`);
  try {
    await stat(dataFile);
  } catch {
    throw new Error("Save local test values before running the browser test");
  }
  const args = [
    path.join(root, "dist", "cli.js"),
    "run",
    file,
    "--data",
    dataFile,
    "--mode",
    "verify",
  ];
  flowTest = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const send = (channel, value) =>
    BrowserWindow.getAllWindows()[0]?.webContents.send(channel, value);
  flowTest.stdout.on("data", (data) => send("flowtest:event", data.toString()));
  flowTest.stderr.on("data", (data) => send("flowtest:event", data.toString()));
  flowTest.on("error", (error) => send("flowtest:event", error.message));
  flowTest.on("exit", (code, signal) => {
    flowTest = null;
    send("flowtest:stopped", { code, signal });
  });
  return true;
});

ipcMain.handle("flowtest:input", async (_e, value = "") => {
  if (!flowTest?.stdin?.writable) throw new Error("No browser test is waiting");
  flowTest.stdin.write(`${value}\n`);
  return true;
});

ipcMain.handle("flowtest:stop", async () => {
  const child = flowTest;
  if (!child) return true;
  child.kill("SIGTERM");
  return true;
});
