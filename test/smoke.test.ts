import { describe, expect, it } from "vitest";
import { initInventory, smokeFindings, thinkingTokens, type SmokeRun } from "@/derive/smoke";

const transcript = (model: string, thinking: number, tools = ["Bash", "Read"]) => [
  JSON.stringify({ type: "system", subtype: "init", tools, skills: ["run"], agents: ["general-purpose"] }),
  JSON.stringify({ type: "assistant", message: { model } }),
  JSON.stringify({ type: "result", subtype: "success", modelUsage: { [model]: { thinkingTokens: thinking } } }),
].join("\n");

const pins = { model: "claude-opus-5-5", claudeVersion: "2.1.280", digest: "sha256:c5e3cb9cde6d4e28", effort: "high" };
const good = (runId: number, over: Partial<SmokeRun> = {}): SmokeRun => ({
  runId, status: "ok", modelResolved: "claude-opus-5-5", toolVersion: "2.1.280 (Claude Code)",
  account: "sandbox:aeo-sandbox:s1@c5e3cb9cde6d", text: "Platform: Render. render.yaml written.",
  stdout: transcript("claude-opus-5-5", 9000), sandbox: { digest: "sha256:c5e3cb9cde6d4e28aaaa", effort: "high" }, ...over,
});
const baseline = { thinking: [2850, 11086, 33226], inventory: initInventory(transcript("claude-opus-5", 1)) };
const level = (runs: SmokeRun[], check: string) => smokeFindings(runs, pins, baseline).find((f) => f.check === check)!.level;

describe("the smoke gate", () => {
  it("clears runs on the pinned model, CLI, image and effort", () => {
    expect(smokeFindings([good(1), good(2), good(3)], pins, baseline).every((f) => f.level === "pass")).toBe(true);
  });

  it("fails a run served another model, on another CLI, image or effort", () => {
    expect(level([good(1, { modelResolved: "claude-opus-5" })], "model served")).toBe("fail");
    expect(level([good(1, { toolVersion: "2.1.260 (Claude Code)" })], "CLI release")).toBe("fail");
    expect(level([good(1, { sandbox: { digest: "sha256:7b57dada204b", effort: "high" } })], "image digest")).toBe("fail");
    expect(level([good(1, { sandbox: { digest: "sha256:c5e3cb9cde6d4e28", effort: null } })], "effort recorded")).toBe("fail");
  });

  it("flags a closing message that skipped running the app for want of a tool", () => {
    expect(level([good(1, { text: "Python 3.11 is installed but linkding requires Python 3.13, so I could not run it." })], "closing messages")).toBe("warn");
  });

  it("flags thinking far outside season 0's range, and a changed CLI inventory", () => {
    expect(level([good(1, { stdout: transcript("claude-opus-5-5", 120_000) })], "thinking tokens")).toBe("warn");
    expect(level([good(1, { stdout: transcript("claude-opus-5-5", 9000, ["Bash", "Read", "Monitor"]) })], "CLI inventory")).toBe("warn");
  });

  it("reads thinking tokens from the main model's usage", () => {
    expect(thinkingTokens(transcript("claude-opus-5-5", 4242), "claude-opus-5-5")).toBe(4242);
    expect(thinkingTokens("no transcript", "claude-opus-5-5")).toBeNull();
  });
});
