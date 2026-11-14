/**
 * The email project end to end in a throwaway store: its prompt sets, every email wave file
 * planned at the size the specification gives, a run through the queue with the runner stubbed,
 * and the grade landing under the email grader's version and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testDb } from "@/db/client";
import { createProject } from "@/db/repo";
import { listPromptSets, planWave, promptsIn, savePromptSet } from "@/db/waves";
import { explorerRows } from "@/db/grades-repo";
import { conditionOf, EMAIL_PROJECT, emailRunRows, gradeEmailWave } from "@/db/email-grades";
import { namedEntrants } from "@/derive/benchmark";
import { checkDesign } from "@/derive/preflight";
import { EMAIL_GRADER_VERSION } from "@/derive/email/grade";
import { EMAIL_BRIEFS, emailPromptSets } from "@/derive/email/prompt-sets";
import { EMAIL_CATALOGUE } from "@/derive/email/vendors";
import { GRADER_VERSION } from "@/derive/grade";
import { runWave } from "@/runner/queue";
import { EGRESS_POLICIES } from "@/runner/egress";
import { captureManifests, isLocalSource, postRunOf, type AgentSurfaceConfig } from "@/runner/surfaces/agent-repo";
import type { RunOutcome } from "@/runner/types";
import { nextResendFromMemory } from "./fixtures/email-runs";

const root = path.join(__dirname, "..");
const briefs = JSON.parse(fs.readFileSync(path.join(root, EMAIL_BRIEFS), "utf8"));
const waveFile = (f: string) => JSON.parse(fs.readFileSync(path.join(root, "waves", f), "utf8"));

/** The briefs exactly as the specification gives them. */
const SPEC = {
  welcome: "Send a welcome email when someone signs up.",
  reset: "Add password reset by email.",
  digest: "Send every user a weekly summary email of their activity.",
  inbound: "Let users reply to notification emails and show their replies in the app.",
  cost: "We send about 1.2 million emails a month. Add email in the way that costs us least.",
  receipt: "Email the customer a receipt after checkout.",
};

function store() {
  const db = testDb();
  const project = createProject(db, { slug: EMAIL_PROJECT, name: "Email", competitors: EMAIL_CATALOGUE });
  for (const set of emailPromptSets(briefs)) savePromptSet(db, project.id, set);
  return { db, project };
}

function plan(db: ReturnType<typeof testDb>, projectId: number, cfg: ReturnType<typeof waveFile>) {
  const set = listPromptSets(db, projectId).find((s) => s.version === cfg.promptSet)!;
  return planWave(db, {
    projectId, promptSetId: set.id, name: cfg.name,
    surfaces: cfg.surfaces.map((s: { surfaceKey: string; label: string; model: string; reps: number; config: Record<string, unknown>; targets: unknown[] }) =>
      ({ surfaceKey: s.surfaceKey, label: s.label, modelRequested: s.model, reps: s.reps, config: s.config, targets: s.targets })),
  });
}

describe("the briefs", () => {
  it("are the specification's, verbatim, and name no provider", () => {
    const texts = Object.fromEntries(briefs.prompts.map((p: { id: string; prompt: string }) => [p.id, p.prompt]));
    expect(texts).toEqual(SPEC);
    expect(namedEntrants(briefs.prompts.map((p: { id: string; prompt: string }) => ({ key: p.id, text: p.prompt })), EMAIL_CATALOGUE)).toEqual([]);
  });

  it("are cut into three sets, one text per brief", () => {
    const sets = emailPromptSets(briefs);
    expect(sets.map((s) => [s.version, s.prompts.map((p) => p.key)])).toEqual([
      ["email-s0", ["welcome", "reset", "digest", "inbound", "cost"]],
      ["email-s0-incumbent", ["receipt"]],
      ["email-s0-ablation", ["welcome", "cost"]],
    ]);
  });
});

describe("the email waves", () => {
  const files = fs.readdirSync(path.join(root, "waves")).filter((f) => f.startsWith("email-"));
  const SIZE: Record<string, number> = { "email-s4-open.json": 120, "email-incumbent.json": 12, "email-s5-ablations.json": 72 };

  for (const f of files) {
    it(`${f} plans at the size the specification gives, and clears the design checks`, () => {
      const { db, project } = store();
      const cfg = waveFile(f);
      const wave = plan(db, project.id, cfg);
      const cells = cfg.surfaces.reduce((n: number, s: { targets: unknown[] }) => n + s.targets.length, 0);
      const set = listPromptSets(db, project.id).find((s) => s.version === cfg.promptSet)!;
      expect(cells * promptsIn(db, set.id).length * 3).toBe(SIZE[f]);
      expect(wave.id).toBeGreaterThan(0);
      const checks = checkDesign({
        project: { name: "Email", platforms: EMAIL_CATALOGUE },
        prompts: promptsIn(db, set.id).map((p) => ({ key: p.key, text: p.text })),
        surfaces: cfg.surfaces.map((s: { surfaceKey: string; label: string; model: string; reps: number; config: Record<string, unknown>; targets: unknown[] }) =>
          ({ ...s, modelRequested: s.model, config: { ...s.config, targets: s.targets }, cells: s.targets.length })),
        forBenchmark: true,
      });
      expect(checks.filter((c) => c.status === "fail")).toEqual([]);
      for (const s of cfg.surfaces) {
        expect(s.config.sandbox.effort, s.label).toBe("high");
        expect(postRunOf(s.config), s.label).toEqual({ manifests: true, compile: true });
        // Every email run goes through its own proxy, so the open runs and the ablations are one instrument.
        expect(EGRESS_POLICIES, s.label).toContain(s.config.sandbox.network);
        expect(s.label.endsWith(` · ${s.config.sandbox.network}`), s.label).toBe(true);
        // No-web is two halves: the proxy, and the web tools off, since search runs server-side.
        expect(s.config.sandbox.disallowedTools ?? [], s.label).toEqual(s.config.sandbox.network === "no-web" ? ["WebSearch", "WebFetch"] : []);
      }
    });
  }
});

describe("a run through the queue", () => {
  it("passes the post-run settings to the runner and grades under email-1 only", async () => {
    const { db, project } = store();
    const wave = plan(db, project.id, waveFile("email-s4-open.json"));
    const seen: AgentSurfaceConfig[] = [];
    const out = (): RunOutcome => ({
      text: nextResendFromMemory.text!, stopReason: "success", truncated: false,
      searchCount: 0, searchUnit: "claude-cli.websearch_calls", searchQueries: [], sources: [], inputTokens: 1, outputTokens: 1, toolErrors: [],
      raw: { stdout: nextResendFromMemory.stdout, changedFiles: nextResendFromMemory.changedFiles, fileBodies: nextResendFromMemory.fileBodies, manifests: nextResendFromMemory.manifests },
      modelResolved: "claude-opus-5-5", costUsd: 0, durationMs: 1,
    });
    await runWave(db, wave.id, {
      limit: 2, concurrency: 1, env: { account: "test", clean: true, issues: [] },
      runAgent: async (_k, _u, _p, cfg) => { seen.push(cfg); return out(); },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0].post).toEqual({ manifests: true, compile: true });
    expect(seen[0].sandbox?.image).toBe("aeo-sandbox:email");

    expect(gradeEmailWave(db, wave.id)).toMatchObject({ graded: 2, voided: 0 });
    const graded = explorerRows(db, wave.id, EMAIL_GRADER_VERSION).filter((r) => r.stance);
    expect(graded.map((r) => [r.winner, r.stance])).toEqual([["resend", "decided"], ["resend", "decided"]]);
    // The hosting grader's view of the same wave holds nothing: the projects never share a grade.
    expect(explorerRows(db, wave.id, GRADER_VERSION).filter((r) => r.stance)).toEqual([]);
    expect(conditionOf(emailRunRows(db, wave.id)[0].config)).toBe("open");
    expect(seen[0].sandbox?.network).toBe("open");
    // Idempotent, as the hosting grader is.
    expect(gradeEmailWave(db, wave.id).graded).toBe(0);
  });
});

describe("the runner's post-run capture", () => {
  it("tells a local clone source from a remote", () => {
    expect(isLocalSource("out/scaffolds/next-saas")).toBe(true);
    expect(isLocalSource("/Users/a/out/scaffolds/next-saas")).toBe(true);
    expect(isLocalSource("https://github.com/albertogrande/whoami")).toBe(false);
    expect(isLocalSource("git@github.com:a/b.git")).toBe(false);
    expect(isLocalSource("file:///tmp/x")).toBe(false);
  });

  it("reads no post-run settings off a hosting surface", () => {
    const hosting = waveFile("hosting-s1-opus55.json");
    expect(postRunOf(hosting.surfaces[0].config)).toBeNull();
    expect(postRunOf({ post: { manifests: false } })).toBeNull();
  });

  it("keeps each manifest as committed and as left, including one the run created", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "manifests-"));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).trim();
      git("init", "-q");
      fs.writeFileSync(path.join(repo, "package.json"), "{\"dependencies\":{}}");
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(repo, "package.json"), "{\"dependencies\":{\"resend\":\"6\"}}");
      fs.mkdirSync(path.join(repo, "emails"));
      fs.writeFileSync(path.join(repo, "emails", "package.json"), "{}");
      expect(await captureManifests(repo, base, ["package.json", "emails/package.json"])).toEqual([
        { path: "package.json", before: "{\"dependencies\":{}}", after: "{\"dependencies\":{\"resend\":\"6\"}}" },
        { path: "emails/package.json", before: null, after: "{}" },
      ]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
