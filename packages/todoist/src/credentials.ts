import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { TodoistError } from "./errors.ts";

/**
 * Where the Todoist API token comes from, in priority order:
 *
 * 1. `TODOIST_API_TOKEN` environment variable (e.g. from a git-ignored .env).
 * 2. `TODOIST_API_TOKEN_FILE`: path to a file that only its owner can read (chmod 600).
 * 3. The OS keychain: macOS Keychain (`security`) or Linux Secret Service (`secret-tool`),
 *    service "frame-os", account "todoist".
 *
 * The token is never written to the repository, the Obsidian vault, the sync cache or logs.
 */

export const KEYCHAIN_SERVICE = "frame-os";
export const KEYCHAIN_ACCOUNT = "todoist";

export type TokenSource = "env" | "file" | "keychain";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

export interface CredentialDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readFile?: (path: string) => Promise<string>;
  /** Returns file mode bits; used to refuse files readable by others. */
  fileMode?: (path: string) => Promise<number>;
  /** Runs a command without a shell and returns stdout. */
  exec?: (cmd: string, args: string[]) => Promise<string>;
}

const defaultExec = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export async function resolveTodoistToken(deps: CredentialDeps = {}): Promise<ResolvedToken | null> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const read = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const mode = deps.fileMode ?? (async (p: string) => (await stat(p)).mode);
  const exec = deps.exec ?? defaultExec;

  const fromEnv = env.TODOIST_API_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };

  const file = env.TODOIST_API_TOKEN_FILE?.trim();
  if (file) {
    if (platform !== "win32") {
      const m = await mode(file).catch(() => {
        throw new TodoistError("not_configured", "TODOIST_API_TOKEN_FILE does not exist or cannot be read");
      });
      if ((m & 0o077) !== 0) {
        throw new TodoistError(
          "not_configured",
          `Token file is readable by other users. Run: chmod 600 "${file}"`,
        );
      }
    }
    const token = (await read(file).catch(() => "")).trim();
    if (token) return { token, source: "file" };
    throw new TodoistError("not_configured", "TODOIST_API_TOKEN_FILE is empty or unreadable");
  }

  if (env.TODOIST_USE_KEYCHAIN === "0") return null;
  try {
    let out = "";
    if (platform === "darwin") {
      out = await exec("security", [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ]);
    } else if (platform === "linux") {
      out = await exec("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT]);
    }
    const token = out.trim();
    if (token) return { token, source: "keychain" };
  } catch {
    // No keychain entry or tool not installed: treat as "not configured".
  }
  return null;
}

export async function requireTodoistToken(deps?: CredentialDeps): Promise<ResolvedToken> {
  const t = await resolveTodoistToken(deps);
  if (!t) throw new TodoistError("not_configured", "Todoist API token not found");
  return t;
}
