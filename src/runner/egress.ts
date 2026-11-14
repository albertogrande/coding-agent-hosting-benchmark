/**
 * Network conditions for a sandboxed run: one egress proxy per run, and an internal network
 * that leaves the session no other way out.
 *
 * The hosting seasons ran on Docker's default network with everything reachable, and a surface
 * that names no `sandbox.network` still does. One that names a policy gets, for that run only:
 *
 *   - an internal Docker network (`docker network create --internal`), which has no route to
 *     anywhere, so a session cannot reach a host the proxy has not let it reach;
 *   - a proxy container (`sandbox/egress/egress-proxy.mjs`) on that network under the alias
 *     `egress` and on the default one, applying the policy (`sandbox/egress/policy.mjs`) and
 *     logging every decision to a directory the session cannot see;
 *   - the session's container on the internal network only, with the proxy in every variable
 *     the tools read, and the proxy's CA certificate trusted, because one condition reads
 *     requests to resend.com and react.email by path.
 *
 * The proxy runs from the run's own image, so it needs nothing the sandbox does not have
 * (Node and openssl). Its source is mounted into its container only. The log comes back on the
 * run's raw record as `egress`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CONTAINER_USER, liveContainers, removeContainer } from "./sandbox";
// The policy list lives with the proxy, which is plain JavaScript so it can run in the image.
import { POLICIES } from "../../sandbox/egress/policy.mjs";

const exec = promisify(execFile);

export const EGRESS_DIR = path.join(import.meta.dirname, "..", "..", "sandbox", "egress");
export const EGRESS_ALIAS = "egress";
export const EGRESS_PORT = 3128;
export const EGRESS_CA_MOUNT = "/etc/egress-ca";
const READY_TIMEOUT_MS = 30_000;
const LOG_MAX_ENTRIES = 5000;

export const EGRESS_POLICIES: readonly string[] = POLICIES;

export const isEgressPolicy = (p: string): boolean => EGRESS_POLICIES.includes(p);

/**
 * What every tool in the session reads to find the proxy and trust its certificate. Upper and
 * lower case both, because curl, pip, npm, git, bundler, Python and Node disagree about which
 * they read first. `NODE_USE_ENV_PROXY` makes Node's own fetch honour the proxy, and
 * `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` tells the CLI the proxy resolves names: the internal network
 * has no DNS for outside hosts, so a CLI that looked a host up itself before fetching would fail.
 */
export function egressEnv(): string[] {
  const proxy = `http://${EGRESS_ALIAS}:${EGRESS_PORT}`;
  const bundle = `${EGRESS_CA_MOUNT}/bundle.pem`;
  return [
    `HTTPS_PROXY=${proxy}`, `https_proxy=${proxy}`, `HTTP_PROXY=${proxy}`, `http_proxy=${proxy}`,
    "NO_PROXY=localhost,127.0.0.1,::1", "no_proxy=localhost,127.0.0.1,::1",
    "NODE_USE_ENV_PROXY=1",
    "CLAUDE_CODE_PROXY_RESOLVES_HOSTS=true",
    `NODE_EXTRA_CA_CERTS=${EGRESS_CA_MOUNT}/ca.crt`,
    `SSL_CERT_FILE=${bundle}`, `REQUESTS_CA_BUNDLE=${bundle}`, `CURL_CA_BUNDLE=${bundle}`, `PIP_CERT=${bundle}`,
  ];
}

/** The session's side: `docker run` arguments that put it behind the proxy. Inserted before the image. */
export function egressRunArgs(e: { network: string; caDir: string }): string[] {
  return [
    "--network", e.network,
    ...egressEnv().flatMap((kv) => ["-e", kv]),
    "-v", `${e.caDir}:${EGRESS_CA_MOUNT}:ro`,
  ];
}

/** The proxy's `docker run` arguments. Pure, so a test can read them. */
export function egressProxyArgs(o: {
  image: string; name: string; network: string; policy: string; caDir: string; logDir: string; egressDir?: string;
}): string[] {
  return [
    "run", "-d", "--rm", "--init", "--name", o.name,
    "--user", CONTAINER_USER,
    "--network", o.network, "--network-alias", EGRESS_ALIAS,
    "-e", `AEO_EGRESS_POLICY=${o.policy}`,
    "-e", `AEO_EGRESS_PORT=${EGRESS_PORT}`,
    "-e", "AEO_EGRESS_LOG=/log/egress.jsonl",
    "-e", "AEO_EGRESS_CA_DIR=/ca",
    "-v", `${o.egressDir ?? EGRESS_DIR}:/egress:ro`,
    "-v", `${o.caDir}:/ca`,
    "-v", `${o.logDir}:/log`,
    o.image,
    "node", "/egress/egress-proxy.mjs",
  ];
}

export type Egress = { network: string; proxy: string; caDir: string; logDir: string; policy: string };

const docker = (args: string[], timeout = 60_000) =>
  exec("docker", args, { timeout, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Starts the network and the proxy for one run and waits until the proxy listens. Anything that
 * fails here is a failed run, not a finding: the error row keeps the cell owed.
 */
export async function startEgress(o: { image: string; name: string; policy: string }): Promise<Egress> {
  if (!isEgressPolicy(o.policy)) throw new Error(`unknown network condition '${o.policy}'`);
  const e: Egress = {
    network: `${o.name}-net`,
    proxy: `${o.name}-egress`,
    caDir: await fs.mkdtemp(path.join(os.tmpdir(), "aeo-egress-ca-")),
    logDir: await fs.mkdtemp(path.join(os.tmpdir(), "aeo-egress-log-")),
    policy: o.policy,
  };
  // The proxy runs as the image's user, which on a Linux host is not the owner of these.
  await fs.chmod(e.caDir, 0o777);
  await fs.chmod(e.logDir, 0o777);
  try {
    await docker(["network", "create", "--internal", e.network]);
    liveContainers.add(e.proxy);
    await docker(egressProxyArgs({ image: o.image, name: e.proxy, network: e.network, policy: o.policy, caDir: e.caDir, logDir: e.logDir }));
    await docker(["network", "connect", "bridge", e.proxy]);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!(await exists(path.join(e.logDir, "ready"))) || !(await exists(path.join(e.caDir, "bundle.pem")))) {
      if (Date.now() > deadline) throw new Error(`the egress proxy did not start within ${READY_TIMEOUT_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, 250));
    }
    return e;
  } catch (err) {
    await stopEgress(e);
    throw new Error(`network condition ${o.policy}: ${(err as Error).message.split("\n")[0]}`);
  }
}

/** One decision the proxy logged. */
export type EgressLogEntry = Record<string, unknown> & { method: string; host: string; decision: string; rule: string };

export function parseEgressLog(text: string, max: number = LOG_MAX_ENTRIES): EgressLogEntry[] {
  const out: EgressLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
    if (out.length >= max) break;
  }
  return out;
}

/** Stops the proxy, removes the network, and returns what the proxy logged. */
export async function stopEgress(e: Egress): Promise<EgressLogEntry[]> {
  await removeContainer(e.proxy);
  liveContainers.delete(e.proxy);
  try { await docker(["network", "rm", e.network]); } catch { /* never created, or already gone */ }
  let log: EgressLogEntry[] = [];
  try { log = parseEgressLog(await fs.readFile(path.join(e.logDir, "egress.jsonl"), "utf8")); } catch { /* nothing logged */ }
  await fs.rm(e.caDir, { recursive: true, force: true });
  await fs.rm(e.logDir, { recursive: true, force: true });
  return log;
}

/** Removes every run network an earlier process left behind. */
export async function sweepNetworks(): Promise<string[]> {
  try {
    const { stdout } = await docker(["network", "ls", "-q", "--filter", "name=^aeo-run-"], 30_000);
    const ids = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const id of ids) { try { await docker(["network", "rm", id]); } catch { /* in use or gone */ } }
    return ids;
  } catch {
    return [];
  }
}

/**
 * What a session under each condition should get back from a few URLs, as curl's status code:
 * `000` is a refused connection. The preflight asks these from inside the image, through a real
 * proxy, before a wave spends a night on a condition that does not hold.
 */
export function egressExpectations(policy: string): { url: string; want: string }[] {
  const send = { url: "https://api.resend.com/emails", want: "000" };
  switch (policy) {
    case "open": return [send, { url: "https://example.com/", want: "200" }];
    case "no-web": return [send, { url: "https://registry.npmjs.org/", want: "200" }, { url: "https://example.com/", want: "000" }];
    case "no-resend": return [send, { url: "https://registry.npmjs.org/", want: "200" }, { url: "https://resend.com/", want: "000" }];
    case "no-machine-files": return [send, { url: "https://resend.com/llms.txt", want: "404" }, { url: "https://resend.com/pricing", want: "200" }];
    default: return [];
  }
}

/** The shell line that asks them, one `url code` pair per line. */
export function egressProbeScript(policy: string): string {
  return egressExpectations(policy)
    .map((e) => `printf '%s %s\\n' '${e.url}' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 '${e.url}')"`)
    .join("; ");
}

/** The URLs whose answer was not what the condition promises, from the probe's output. */
export function egressMismatches(policy: string, output: string): string[] {
  const got = new Map(output.split("\n").map((l) => l.trim().split(" ")).filter((p) => p.length === 2).map(([u, c]) => [u, c]));
  return egressExpectations(policy)
    .filter((e) => got.get(e.url) !== e.want)
    .map((e) => `${e.url}: wanted ${e.want}, got ${got.get(e.url) ?? "nothing"}`);
}
