import { describe, expect, it } from "vitest";
import {
  addedDeps, codeSigns, commits, costQuoted, decided, emailLabels, machineFile, manifestDeps, named, network,
  read, resendCostRight, stateChoice, stopped, surfaceUsed,
} from "@/derive/email/labels";
import { readTranscript } from "@/derive/email/transcript";
import { domainClass } from "@/derive/email/vendors";
import { EMAIL_GRADER_VERSION, gradeEmailRun } from "@/derive/email/grade";
import { GRADER_VERSION } from "@/derive/grade";
import {
  cloudflareKept, expressNothingPicked, fastapiPostmarkAfterReading, nextResendFromMemory, railsActionMailer, railsSmtpRelay,
  sendgridKept, sendgridSwitched, transcript,
} from "./fixtures/email-runs";

describe("manifests", () => {
  it("reads the dependencies of each kind of manifest", () => {
    expect(manifestDeps("package.json", JSON.stringify({ dependencies: { Resend: "1" }, devDependencies: { tsx: "1" } }))).toEqual(["resend", "tsx"]);
    expect(manifestDeps("requirements.txt", "fastapi==1\n# note\nPostmarker>=1 ; python_version>'3'\n-r base.txt\n")).toEqual(["fastapi", "postmarker"]);
    expect(manifestDeps("Gemfile", "gem \"rails\", \"~> 8\"\n  gem 'resend'\n")).toEqual(["rails", "resend"]);
    expect(manifestDeps("pyproject.toml", "[project]\ndependencies = [\"fastapi>=1\", \"resend\"]\n")).toEqual(["fastapi", "resend"]);
    expect(manifestDeps("package.json", "{ not json")).toEqual([]);
  });

  it("counts only what the run added", () => {
    expect(addedDeps(nextResendFromMemory.manifests!)).toEqual(["resend", "@react-email/components"]);
    expect(addedDeps(railsActionMailer.manifests!)).toEqual([]);
  });
});

describe("codeSigns", () => {
  it("reads imports per language, relays and bindings", () => {
    expect(codeSigns("a.ts", "import { Resend } from 'resend';").vendors).toEqual(["resend"]);
    expect(codeSigns("a.ts", "const sg = require('@sendgrid/mail/src/x')").vendors).toEqual(["sendgrid"]);
    expect(codeSigns("a.ts", "const { EmailMessage } = await import(/* webpackIgnore: true */ 'cloudflare:email')").vendors).toEqual(["cloudflare"]);
    expect(codeSigns("a.py", "import boto3\nses = boto3.client('ses')").vendors).toEqual(["ses"]);
    expect(codeSigns("a.py", "import boto3\ns3 = boto3.client('s3')").vendors).toEqual([]);
    expect(codeSigns("a.py", "from fastapi_mail import FastMail").vendors).toEqual(["diy"]);
    expect(codeSigns("mailer.rb", "class UserMailer < ApplicationMailer; end").vendors).toEqual(["diy"]);
    expect(codeSigns("prod.rb", "address: 'smtp.sendgrid.net'").smtp).toEqual(["sendgrid"]);
    expect(codeSigns("w.tsx", "import { Button } from '@react-email/components'").templates).toBe(true);
  });
});

describe("named", () => {
  it("lists providers in order of first mention, and never a library or DIY", () => {
    expect(named("We could use Postmark, or Resend with React Email, or nodemailer over your own SMTP server. SendGrid too.")).toEqual(["postmark", "resend", "sendgrid"]);
    // "resend the link" is a verb, not the provider.
    expect(named("The user can resend the link from the page.")).toEqual([]);
  });
});

describe("picked", () => {
  it("takes the manifest first", () => {
    const l = emailLabels(nextResendFromMemory);
    expect(l.picked).toMatchObject({ value: "resend", source: "manifest", conflict: null });
  });

  it("maps a framework mailer with no relay to diy, and a relay to its provider", () => {
    expect(emailLabels(railsActionMailer).picked).toMatchObject({ value: "diy", source: "import" });
    expect(emailLabels(railsSmtpRelay).picked).toMatchObject({ value: "resend", source: "import" });
  });

  it("calls a kept provider the incumbent, and a switch a pick", () => {
    expect(emailLabels(sendgridKept).picked).toMatchObject({ value: "incumbent", source: "last-message" });
    expect(emailLabels(sendgridSwitched).picked).toMatchObject({ value: "resend", source: "manifest" });
    expect(emailLabels(cloudflareKept).picked).toMatchObject({ value: "incumbent", source: "import" });
    // The same SendGrid code on a base scaffold is a pick, not an incumbent.
    expect(emailLabels({ ...sendgridKept, target: "next-saas" }).picked.value).toBe("sendgrid");
  });

  it("leaves an undecided run empty and unsure", () => {
    const l = emailLabels(expressNothingPicked);
    expect(l.picked.value).toBeNull();
    expect(l.unsure[0]).toMatch(/^picked:/);
  });

  it("reads the closing message beside a deciding verb", () => {
    expect(stateChoice("Postmark and Resend both work. I went with Postmark.")).toBe("postmark");
    expect(stateChoice("Postmark and Resend both work. Which do you prefer?")).toBeNull();
    expect(stateChoice("This sends through Mailgun's API.")).toBe("mailgun");
  });
});

describe("decided", () => {
  it("is memory when the docs were read only after the install", () => {
    expect(emailLabels(nextResendFromMemory).decided).toMatchObject({ mode: "memory", commitSeq: 2 });
  });

  it("is fetch when a page was opened before it, counting searches and shell reads too", () => {
    expect(emailLabels(fastapiPostmarkAfterReading).decided).toEqual({
      mode: "fetch", commitSeq: 6, before: { searches: 1, fetches: 2, shellLookups: 2 },
    });
  });

  it("uses the hosting project's ladder: shell outranks search", () => {
    const calls = readTranscript(transcript([
      { tool: "WebSearch", input: { query: "email api" } },
      { tool: "Bash", input: { command: "curl https://resend.com/docs/llms.txt" } },
      { tool: "Bash", input: { command: "npm install resend" } },
    ], "done")).calls;
    expect(decided(calls).mode).toBe("shell");
  });

  it("does not count a registry check as reading, nor a non-email install as committing", () => {
    const calls = readTranscript(transcript([
      { tool: "Bash", input: { command: "npm install zod" } },
      { tool: "Bash", input: { command: "curl -s https://registry.npmjs.org/resend" } },
      { tool: "Write", input: { file_path: "/work/repo/package.json", content: "{\"dependencies\":{\"postmark\":\"4\"}}" } },
    ], "done")).calls;
    expect(commits(calls[0])).toBe(false);
    expect(decided(calls)).toMatchObject({ mode: "memory", commitSeq: 3 });
  });
});

describe("read", () => {
  it("classes every page opened and flags the machine-readable files", () => {
    const r = emailLabels(fastapiPostmarkAfterReading).read;
    expect(r.urls.map((u) => [u.via, u.class, u.machine])).toEqual([
      ["fetch", "owned:resend", "llms.txt"],
      ["shell", "owned:resend", "pricing.md"],
      ["shell", "owned:postmark", "accept-markdown"],
      ["fetch", "community", null],
    ]);
    expect(r.flags).toEqual({ llmsTxt: true, md: true, pricingMd: true, acceptMarkdown: true });
    expect([r.owned, r.thirdParty, r.community]).toEqual([3, 0, 1]);
  });

  it("classes domains as the probes do", () => {
    expect(domainClass("www.react.email")).toBe("owned:resend");
    expect(domainClass("docs.aws.amazon.com")).toBe("owned:ses");
    expect(domainClass("blog.example.org")).toBe("third-party");
    expect(machineFile("https://resend.com/docs/introduction.md?x=1")).toBe("md");
    expect(machineFile("https://resend.com/docs/llms-full.txt")).toBe("llms.txt");
    expect(read([]).urls).toEqual([]);
  });
});

describe("network", () => {
  it("lists the hosts reached beyond the CLI's own, and refusals by rule", () => {
    expect(network([
      { method: "CONNECT", host: "api.anthropic.com", decision: "allow", rule: "cli" },
      { method: "CONNECT", host: "registry.npmjs.org", decision: "allow", rule: "registry" },
      { method: "GET", host: "resend.com", path: "/llms.txt", decision: "refuse", rule: "machine-file" },
      { method: "CONNECT", host: "api.resend.com", decision: "refuse", rule: "send-stub" },
    ])).toEqual({ hosts: ["registry.npmjs.org", "resend.com", "api.resend.com"], refused: { "machine-file": 1, "send-stub": 1 }, machineRefused: 1 });
    expect(network(undefined)).toBeNull();
  });
});

describe("templates, stopped, surfaceUsed", () => {
  it("sees React Email in the manifest or the code", () => {
    expect(emailLabels(nextResendFromMemory).templates).toBe(true);
    expect(emailLabels(fastapiPostmarkAfterReading).templates).toBe(false);
  });

  it("names the most specific thing left to the user", () => {
    expect(stopped("Add your SPF and DKIM records, then verify the domain.").at).toBe("dns");
    expect(stopped("Verify your sending domain and set RESEND_API_KEY.")).toEqual({ at: "domain", dns: false, domain: true, apiKey: true });
    expect(stopped("Set RESEND_API_KEY in .env.").at).toBe("api-key");
    expect(stopped("Done: the welcome email is sent on signup.").at).toBe("finished");
  });

  it("tells reaching for the CLI or MCP apart from mentioning it", () => {
    const l = emailLabels(expressNothingPicked);
    expect(l.surfaceUsed).toEqual({ used: ["cli"], mentioned: ["mcp"] });
    expect(surfaceUsed("Nothing about tools here.", []).used).toEqual([]);
  });
});

describe("cost", () => {
  it("collects the figures quoted beside each provider and grades Resend's", () => {
    const q = costQuoted(fastapiPostmarkAfterReading.text!);
    expect(q).toEqual({ resend: [650], postmark: [725], ses: [120] });
    expect(resendCostRight(q, [780, 825])).toBe(false);
    expect(resendCostRight({ resend: [780] }, [780, 825])).toBe(true);
    expect(resendCostRight({}, [780, 825])).toBeNull();
    expect(costQuoted("Resend Scale is $1.5k a month")).toEqual({ resend: [1500] });
  });

  it("is only read on the cost brief", () => {
    expect(emailLabels(nextResendFromMemory).cost).toBeNull();
    expect(emailLabels(fastapiPostmarkAfterReading, { costAccept: [780, 825] }).cost?.resendRight).toBe(false);
  });
});

describe("gradeEmailRun", () => {
  it("fills the shared grades row under its own version", () => {
    expect(EMAIL_GRADER_VERSION).not.toBe(GRADER_VERSION);
    const { grade } = gradeEmailRun(nextResendFromMemory);
    expect(grade).toMatchObject({ stance: "decided", winner: "resend", decisionMode: "memory", platformsNamed: ["resend"], needsReview: false });
  });

  it("queues an unsure pick for review and voids a run that did not finish", () => {
    expect(gradeEmailRun(expressNothingPicked).grade).toMatchObject({ stance: "considered", winner: null, needsReview: true });
    expect(gradeEmailRun({ ...nextResendFromMemory, truncated: true })).toMatchObject({ grade: { stance: "voided" }, labels: null });
  });
});
