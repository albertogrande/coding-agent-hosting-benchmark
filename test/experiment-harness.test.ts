import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { credentialsExpiry, sandboxOf, sandboxRunArgs } from "@/runner/sandbox";
import { applyOverlay, usageOf } from "@/runner/surfaces/agent-repo";

describe("sandboxRunArgs with the machine's own login", () => {
  const args = sandboxRunArgs({
    image: "aeo-sandbox:e6-none", root: "/tmp/r", name: "aeo-run-2", cmd: "claude", args: ["-p", "hi"],
    credentialsFile: "/home/u/.claude/.credentials.json", network: "host",
  });
  it("mounts the login read-only where Claude Code looks for it, and passes no token", () => {
    expect(args).toContain("/home/u/.claude/.credentials.json:/home/bench/.claude/.credentials.json:ro");
    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
  it("joins the network it is given", () => {
    expect(args[args.indexOf("--network") + 1]).toBe("host");
  });
  it("leaves the published invocation unchanged when neither is set", () => {
    const plain = sandboxRunArgs({ image: "i", root: "/r", name: "n", cmd: "c", args: [] });
    expect(plain).not.toContain("--network");
    expect(plain).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
  it("is read from a wave or design config", () => {
    expect(sandboxOf({ sandbox: { image: "i", auth: "credentials-file", network: "host" } }))
      .toMatchObject({ auth: "credentials-file", network: "host" });
    expect(sandboxOf({ sandbox: { image: "i", auth: "bogus" } })).not.toHaveProperty("auth");
  });
});

describe("credentialsExpiry", () => {
  it("reads only the expiry, and null when it cannot", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cred-")), "c.json");
    fs.writeFileSync(f, JSON.stringify({ claudeAiOauth: { accessToken: "x", expiresAt: 123 } }));
    expect(credentialsExpiry(f)).toBe(123);
    expect(credentialsExpiry("/nonexistent")).toBeNull();
  });
});

describe("applyOverlay", () => {
  it("commits the overlay as the new base under a neutral identity, with {{app}} filled in", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ov-repo-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    g("init", "-q"); fs.writeFileSync(path.join(repo, "a.txt"), "a");
    g("add", "a.txt"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    const ov = fs.mkdtempSync(path.join(os.tmpdir(), "ov-"));
    fs.mkdirSync(path.join(ov, "docs")); fs.writeFileSync(path.join(ov, "docs", "AGENTS.md"), "# {{app}}\n");
    const files = await applyOverlay(repo, { dir: ov, app: "whoami" });
    expect(files).toEqual([path.join("docs", "AGENTS.md")]);
    expect(fs.readFileSync(path.join(repo, "docs", "AGENTS.md"), "utf8")).toBe("# whoami\n");
    expect(g("log", "-1", "--format=%an %s")).toBe("maintainer Update project notes");
    expect(g("status", "--porcelain")).toBe("");
  });
});

describe("usageOf", () => {
  it("reads tokens, turns and the API-equivalent price from the result line", () => {
    const out = [
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "result", num_turns: 7, total_cost_usd: 1.25, duration_api_ms: 9000,
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } }),
    ].join("\n");
    expect(usageOf(out)).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40,
      numTurns: 7, totalCostUsd: 1.25, durationApiMs: 9000 });
    expect(usageOf("not json").totalCostUsd).toBeNull();
  });
});
