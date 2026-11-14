import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileCheckArgs, parseCompileOutput } from "@/runner/post-run";

describe("compileCheckArgs", () => {
  const args = compileCheckArgs({ image: "sha256:abc", root: "/tmp/r", inputDir: "/tmp/in", name: "aeo-run-1-check", checksDir: "/h/sandbox/checks" });

  it("mounts the tree, the checks read-only and the input, and runs the check as the non-root user", () => {
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args[args.indexOf("--user") + 1]).toBe("bench");
    expect(args).toContain("/tmp/r:/work");
    expect(args).toContain("/h/sandbox/checks:/checks:ro");
    expect(args).toContain("/tmp/in:/check:ro");
    expect(args.slice(-4)).toEqual(["sha256:abc", "node", "/checks/compile.mjs", "/check/input.json"]);
  });

  it("carries no token and no network flag: it is the harness installing, not the agent", () => {
    expect(args.join(" ")).not.toMatch(/OAUTH|TOKEN|--network/);
  });
});

describe("parseCompileOutput", () => {
  it("reads the last verdict line and says when there was none", () => {
    expect(parseCompileOutput("npm noise\n@@COMPILE {\"status\":\"pass\",\"tool\":\"tsc --noEmit\",\"detail\":\"\"}\n"))
      .toEqual({ status: "pass", tool: "tsc --noEmit", detail: "" });
    expect(parseCompileOutput("boom").status).toBe("not-run");
    expect(parseCompileOutput("@@COMPILE {bad").status).toBe("not-run");
  });
});

/**
 * The Python half against the standard library's own SMTP client, so it needs no network and
 * no package: a call that binds, one that does not, an attribute that does not exist, and a
 * file that does not compile.
 */
const python = spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(!python)("pycheck.py", () => {
  const pycheck = path.join(__dirname, "..", "sandbox", "checks", "pycheck.py");
  const run = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pycheck-"));
    try {
      for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
      const r = spawnSync("python3", [pycheck, ...Object.keys(files)], { cwd: dir, encoding: "utf8" });
      return JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("@@PY "))!.slice(5));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("passes calls that bind to the installed signature", () => {
    expect(run({ "ok.py": "import smtplib\ndef f():\n    smtplib.SMTP('localhost', 25)\n" }).status).toBe("pass");
  });

  it("fails a call the signature rejects and an attribute that does not exist", () => {
    const r = run({ "bad.py": "import smtplib\nfrom smtplib import SMTP\ndef f():\n    SMTP(nonsense=1)\n    smtplib.SMTPP('h')\n" });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/bad\.py:4: SMTP.*rejects this call/);
    expect(r.detail).toMatch(/bad\.py:5: smtplib\.SMTPP does not exist/);
  });

  it("fails a file that does not compile, and has nothing to say about code with no email module", () => {
    expect(run({ "broken.py": "import smtplib\ndef f(:\n" }).status).toBe("fail");
    expect(run({ "plain.py": "import json\njson.dumps({})\n" }).status).toBe("n/a");
  });
});
