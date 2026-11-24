import { describe, expect, it } from "vitest";
import { requireTodoistToken, resolveTodoistToken } from "../src/credentials.ts";

const noKeychain = async () => {
  throw new Error("not found");
};

describe("resolveTodoistToken", () => {
  it("prefers the environment variable", async () => {
    const r = await resolveTodoistToken({ env: { TODOIST_API_TOKEN: " abc \n" }, exec: noKeychain });
    expect(r).toEqual({ token: "abc", source: "env" });
  });

  it("reads a private token file", async () => {
    const r = await resolveTodoistToken({
      env: { TODOIST_API_TOKEN_FILE: "/home/me/.config/frame-os/todoist.token" },
      platform: "linux",
      fileMode: async () => 0o100600,
      readFile: async () => "from-file\n",
    });
    expect(r).toEqual({ token: "from-file", source: "file" });
  });

  it("refuses a token file other users can read", async () => {
    await expect(
      resolveTodoistToken({
        env: { TODOIST_API_TOKEN_FILE: "/tmp/t" },
        platform: "linux",
        fileMode: async () => 0o100644,
        readFile: async () => "x",
      }),
    ).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("chmod 600") });
  });

  it("falls back to the macOS Keychain without a shell", async () => {
    const calls: [string, string[]][] = [];
    const r = await resolveTodoistToken({
      env: {},
      platform: "darwin",
      exec: async (cmd, args) => {
        calls.push([cmd, args]);
        return "kc-token\n";
      },
    });
    expect(r).toEqual({ token: "kc-token", source: "keychain" });
    expect(calls[0]).toEqual(["security", ["find-generic-password", "-s", "frame-os", "-a", "todoist", "-w"]]);
  });

  it("uses secret-tool on Linux", async () => {
    let cmd = "";
    await resolveTodoistToken({ env: {}, platform: "linux", exec: async (c) => ((cmd = c), "t") });
    expect(cmd).toBe("secret-tool");
  });

  it("returns null when nothing is configured, and require throws not_configured", async () => {
    expect(await resolveTodoistToken({ env: {}, platform: "linux", exec: noKeychain })).toBeNull();
    await expect(requireTodoistToken({ env: {}, platform: "linux", exec: noKeychain })).rejects.toMatchObject({
      code: "not_configured",
    });
  });

  it("can skip the keychain", async () => {
    let called = false;
    const r = await resolveTodoistToken({
      env: { TODOIST_USE_KEYCHAIN: "0" },
      platform: "darwin",
      exec: async () => ((called = true), "x"),
    });
    expect(r).toBeNull();
    expect(called).toBe(false);
  });
});
