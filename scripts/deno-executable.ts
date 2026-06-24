import { join } from "@std/path";

async function isExecutable(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function resolveHomeDir(): string | null {
  const home = Deno.env.get("HOME")?.trim();
  if (home) {
    return home;
  }

  if (Deno.build.os === "windows") {
    const userProfile = Deno.env.get("USERPROFILE")?.trim();
    if (userProfile) {
      return userProfile;
    }
    const homeDrive = Deno.env.get("HOMEDRIVE")?.trim();
    const homePath = Deno.env.get("HOMEPATH")?.trim();
    if (homeDrive && homePath) {
      return `${homeDrive}${homePath}`;
    }
  }

  return null;
}

export async function resolveDenoExecutable(): Promise<string> {
  const envPath = Deno.env.get("DENO_BIN")?.trim();
  if (envPath) {
    return envPath;
  }

  const homeDir = resolveHomeDir();
  if (homeDir) {
    const executableName = Deno.build.os === "windows" ? "deno.exe" : "deno";
    const localInstallPath = join(homeDir, ".deno", "bin", executableName);
    if (await isExecutable(localInstallPath)) {
      return localInstallPath;
    }
  }

  return "deno";
}
