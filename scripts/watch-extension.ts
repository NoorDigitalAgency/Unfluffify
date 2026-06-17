const ROOT = Deno.cwd();
const WATCH_PATHS = [
  "background",
  "common",
  "content",
  "popup",
  "assets",
  "cursors",
  "icons",
  "background.ts",
  "content-loader.ts",
  "content-main.ts",
  "popup.ts",
  "popup.html",
  "popup.css",
  "theme-color.css",
  "theme-components.css",
  "theme-utilities.css",
  "manifest.json"
].map((path) => `${ROOT}/${path}`);

let building = false;
let pending = false;

async function runBuild(): Promise<void> {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  try {
    console.log("[watch] running check");
    await new Deno.Command("deno", {
      args: ["task", "check"],
      stdout: "inherit",
      stderr: "inherit"
    }).output();

    console.log("[watch] rebuilding dev extension");
    const result = await new Deno.Command("deno", {
      args: ["task", "build:dev"],
      stdout: "inherit",
      stderr: "inherit"
    }).output();

    if (result.code !== 0) {
      console.error(`[watch] build failed with code ${result.code}`);
    } else {
      console.log("[watch] build complete");
    }
  } finally {
    building = false;
    if (pending) {
      pending = false;
      setTimeout(() => {
        runBuild();
      }, 100);
    }
  }
}

await runBuild();

const watcher = Deno.watchFs(WATCH_PATHS);
let debounceTimer: number | null = null;

for await (const event of watcher) {
  if (!event.paths || event.paths.length === 0) {
    continue;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    console.log(`[watch] change detected (${event.kind})`);
    runBuild();
  }, 250);
}
