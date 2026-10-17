/**
 * One disposable container per agent run.
 *
 * Wave 2 ran from a clean HOME on the measuring Mac, and the audit in
 * `docs/WAVE-3-DESIGN.md` found two things a HOME cannot fix: an agent that reads its
 * environment read the shim source under this repository and learned what the harness was
 * for, and processes one run left behind were found by the next one and read as facts about
 * the user's machine. A container starts from an image with nothing on it, and `docker rm`
 * ends it with nothing left. The image digest is stored on every run, next to the CLI
 * release and the model served, because the sandbox is part of the instrument.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { EnvStamp } from "@/db/schema";

const exec = promisify(execFile);

export type SandboxConfig = {
  /** The image every cell runs in, as tagged on the measuring machine. */
  image: string;
  /**
   * The Claude Code release the image must carry. A wave cannot be compared with the next
   * one if the CLI moved underneath it, so a mismatch refuses the wave rather than running
   * it on whatever `npm install -g` fetched that day.
   */
  claudeVersion?: string;
  /**
   * The image's content id, `sha256:…`, as `docker image inspect` reports it. Pinned in the
   * wave file because a tag is not an instrument: season 0 rebuilt `aeo-sandbox:s0` mid-wave
   * under the same tag, and a later rebuild floated Python and uv along with the CLI. Checked
   * before every run, so a rebuild during a wave stops it instead of being stamped with the
   * digest the wave started on.
   */
  digest?: string;
  /**
   * The reasoning effort passed to the CLI as `--effort`. Each model carries its own default
   * in the CLI's catalog (Opus 5: high, Opus 5.5: medium), so a wave that leaves it unset
   * changes effort whenever it changes the model, and nothing in the transcript says so.
   */
  effort?: string;
};

/** Where the harness reads the subscription token from. `claude setup-token` prints it. */
export const SANDBOX_TOKEN_FILE = path.join(os.homedir(), ".config", "aeo", "claude-oauth-token");

/**
 * The token that lets Claude Code inside the container use the Max subscription. Read from
 * the environment first so a test or a CI job can inject one, then from the file. Never
 * from `CLAUDE_CODE_OAUTH_TOKEN` on the host: the harness strips that prefix from every
 * child precisely so a host session cannot leak into a run.
 */
export function readSandboxToken(
  env: Record<string, string | undefined> = process.env,
  file: string = SANDBOX_TOKEN_FILE,
): string | null {
  const fromEnv = env.AEO_CLAUDE_OAUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

export const CONTAINER_USER = "bench";
export const CONTAINER_WORK = "/work";

export function containerName(): string {
  return `aeo-run-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * The `docker run` argument list for one cell. Pure, so a test can read it.
 *
 * The token is not in the list: `-e NAME` with no value tells Docker to copy it from the
 * client's own environment, which keeps it out of `ps` and out of the stored command.
 * `--rm` removes the container when the CLI exits; a timeout kills the client, not the
 * container, so the caller also removes it by name afterwards.
 */
export function sandboxRunArgs(o: {
  image: string;
  root: string;
  name: string;
  cmd: string;
  args: string[];
}): string[] {
  return [
    "run", "--rm", "--init", "--name", o.name,
    "--user", CONTAINER_USER,
    "-e", "CI=1",
    "-e", "CLAUDE_CODE_OAUTH_TOKEN",
    "-v", `${o.root}:${CONTAINER_WORK}`,
    "-w", `${CONTAINER_WORK}/repo`,
    o.image,
    o.cmd, ...o.args,
  ];
}

export async function removeContainer(name: string): Promise<void> {
  try { await exec("docker", ["rm", "-f", name], { timeout: 60_000 }); } catch { /* already gone */ }
}

/**
 * Containers this process has started and not yet removed. A second Ctrl-C removes them
 * before exiting: the docker client runs in its own process group, so killing the runner
 * leaves the agent running inside its container, spending the subscription on a run nobody
 * will store.
 */
export const liveContainers = new Set<string>();

/** Removes every container a run of this harness left behind, from any earlier process. */
export async function sweepContainers(): Promise<string[]> {
  try {
    const { stdout } = await exec("docker", ["ps", "-aq", "--filter", "name=^aeo-run-"], { timeout: 30_000 });
    const ids = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const id of ids) await removeContainer(id);
    return ids;
  } catch {
    return [];
  }
}

/**
 * The image's content id, as Docker reports it now. Null when the image is not present.
 * Never cached: the tag can be rebuilt between two runs of the same process, and the digest
 * is what says which image a run actually had.
 */
export async function imageDigest(image: string): Promise<string | null> {
  try {
    const r = await exec("docker", ["image", "inspect", "--format", "{{.Id}}", image], { timeout: 30_000 });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

const versionCache = new Map<string, Promise<string | null>>();

/**
 * What `claude --version` says inside the image. Cached by digest rather than by tag: one
 * image always carries one release, and a rebuilt tag is a different digest and is asked
 * again.
 */
export async function imageCliVersion(image: string): Promise<string | null> {
  const digest = await imageDigest(image);
  if (!digest) return null;
  if (!versionCache.has(digest)) {
    versionCache.set(digest, exec("docker", ["run", "--rm", digest, "claude", "--version"], { timeout: 120_000 })
      .then((r) => r.stdout.trim().split("\n")[0]?.trim() || null)
      .catch(() => null));
  }
  return versionCache.get(digest)!;
}

/** True when the digest Docker reports is the one the wave pinned. A full or short id both match. */
export function digestMatches(reported: string | null, pinned: string | undefined): boolean {
  if (!pinned) return true;
  if (!reported) return false;
  const bare = (d: string) => d.replace(/^sha256:/, "");
  return bare(reported).startsWith(bare(pinned));
}

/** True when the version the image reports is the one the wave pinned. */
export function versionMatches(reported: string | null, pinned: string | undefined): boolean {
  if (!pinned) return true;
  return !!reported && reported.startsWith(pinned);
}

/**
 * What the row says about where it ran. A sandboxed run is clean by construction — there
 * is no home to read a token from — and the account it carries is the image, by digest, so
 * two waves on different images cannot be read as the same instrument.
 */
export async function sandboxStamp(image: string): Promise<EnvStamp> {
  const digest = await imageDigest(image);
  if (!digest) throw new Error(`sandbox image ${image} is not present — build it with \`docker build -t ${image} sandbox/\``);
  return { account: `sandbox:${image}@${digest.replace(/^sha256:/, "").slice(0, 12)}`, clean: true, issues: [] };
}

/**
 * A deterministic shuffle, so the order a wave ran in is a number in the wave file rather
 * than the order the cells were planned in.
 *
 * Wave 2 ran its cells in frame blocks — all 33 cost runs, then least-effort, then open,
 * then production — so the frame effect and the time of night were the same variable. A
 * seed written down makes the order random and repeatable; on a resume the remaining runs
 * are shuffled again with the same seed, which is a different permutation of a shorter
 * list and still random with respect to the cell.
 */
export function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = list.slice();
  let s = (seed >>> 0) || 1;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The sandbox a planned surface asks for, or null when it runs on the host. */
export function sandboxOf(config: Record<string, unknown> | undefined): SandboxConfig | null {
  const s = config?.sandbox as Partial<SandboxConfig> | undefined;
  if (!s || typeof s.image !== "string" || !s.image) return null;
  return {
    image: s.image,
    ...(typeof s.claudeVersion === "string" ? { claudeVersion: s.claudeVersion } : {}),
    ...(typeof s.digest === "string" ? { digest: s.digest } : {}),
    ...(typeof s.effort === "string" ? { effort: s.effort } : {}),
  };
}

/** The order seed a planned surface asks for, or undefined for the planned order. */
export function orderSeedOf(config: Record<string, unknown> | undefined): number | undefined {
  const o = config?.order as { seed?: unknown } | undefined;
  return typeof o?.seed === "number" ? o.seed : undefined;
}
