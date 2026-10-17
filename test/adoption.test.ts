import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/agent-transcripts.json";
import {
  adoption, canon, configSignals, decisionMode, deployArtifacts, statedChoice,
} from "@/derive/adoption";

/**
 * The regression corpus: 22 real runs from the original Codex wave, each with the
 * platform Gauge itself recorded as adopted. The ladder's final-message tier has to
 * reproduce that verdict from the agent's own prose.
 */
describe("against Gauge's own adoption verdicts", () => {
  const decided = fixtures.filter((f) => f.adopted.length === 1);

  it("reads the right platform out of the agent's closing prose", () => {
    const wrong = decided
      .map((f) => ({ f, got: statedChoice(f.prose)?.platform ?? null }))
      .filter(({ f, got }) => got !== null && got !== canon(f.adopted[0]))
      .map(({ f, got }) => `${f.repo}: Gauge said ${f.adopted[0]}, ladder said ${got}`);
    expect(wrong).toEqual([]);
  });

  it("finds a stated choice in most of them, and never invents one", () => {
    const found = decided.filter((f) => statedChoice(f.prose) !== null);
    // Not every transcript closes with a decision sentence — one original cell adopted
    // Cloud Run through a shell script and never wrote "I chose". The point is that the
    // ones it does read, it reads correctly, and the rest fall to a lower tier.
    expect(found.length).toBeGreaterThan(decided.length * 0.6);
  });

  /**
   * Branded runs name the platform in the prompt, so adoption is near-guaranteed: they
   * measure whether the docs are good enough to build with, not whether the agent
   * reaches for the platform. Pooling the two is a category error, and the corpus keeps
   * them labelled so a test can prove they are separable.
   */
  it("keeps branded and unbranded runs distinguishable", () => {
    const branded = fixtures.filter((f) => f.branded);
    const unbranded = fixtures.filter((f) => !f.branded);
    expect(branded.length).toBeGreaterThan(0);
    expect(unbranded.length).toBeGreaterThan(0);
    // Every branded run adopted the platform it was told to, which is exactly why its
    // adoption rate says nothing about demand.
    expect(branded.every((f) => f.adopted.includes("Railway"))).toBe(true);
  });
});

describe("the adoption ladder", () => {
  /**
   * A config file committed to the repository is the decision; prose is a description of
   * one. Agents routinely commit their work, which empties `git status` — so the changed
   * set must include what was committed since the clone's base, or the strongest signal
   * is missing from exactly the runs that did the most.
   */
  it("prefers a written config file over anything said", () => {
    const a = adoption({ changedFiles: ["render.yaml", "README.md"], finalText: "Lots of options here." });
    expect(a.adopted).toBe("Render");
    expect(a.source).toBe("config-file");
  });

  it("lets the closing message overrule the file, and records the clash", () => {
    const a = adoption({
      changedFiles: ["fly.toml"],
      finalText: "I explored Fly first.\nIn the end I chose Railway for the managed Postgres.",
    });
    expect(a.adopted).toBe("Railway");
    expect(a.source).toBe("final-message");
    expect(a.conflict).toMatch(/config says Fly\.io, closing message says Railway/);
    expect(a.evidence.join(" ")).toMatch(/config: Fly\.io/);
  });

  /**
   * whoami × open, reps 1 and 2 of the pilot: `fly.toml` and a `fly deploy` in the files,
   * and a closing message whose only decision-shaped sentence was a warning about other
   * platforms. Two written tiers agreeing are a finished deployment, and the prose is then
   * the weaker witness. The clash is still recorded so a person looks.
   */
  it("does not let the closing message overrule a config file the deploy command confirms", () => {
    const a = adoption({
      changedFiles: ["fly.toml", "DEPLOY.md"],
      fileBodies: [{ path: ".github/workflows/deploy.yml", body: "run: flyctl deploy --remote-only" }],
      finalText: "Anyone deploying to Render/Cloud Run/Railway will hit the port trap.\nSee DEPLOY.md.",
    });
    expect(a.adopted).toBe("Fly.io");
    expect(a.source).toBe("config-file");
    expect(a.conflict).toMatch(/config file and deploy command both say Fly\.io, closing message says Render/);
  });

  // One original cell adopted Cloud Run through a shell script and a CI workflow, with
  // no app.yaml anywhere and no "I chose" sentence. A real deploy command is as concrete
  // as a config file.
  it("falls back to a real deploy command when no config file exists", () => {
    const a = adoption({
      changedFiles: ["deploy/cloudrun.sh"],
      fileBodies: [{ path: "deploy/cloudrun.sh", body: "#!/bin/sh\ngcloud run deploy api --source ." }],
      finalText: "- built the image\n- wired the workflow",
    });
    expect(a.adopted).toBe("Google Cloud Run");
    expect(a.source).toBe("deploy-artifact");
  });

  it("ignores deploy commands quoted in documentation", () => {
    expect(deployArtifacts([{ path: "README.md", body: "run `fly deploy` to ship" }])).toEqual([]);
    expect(deployArtifacts([{ path: "ship.sh", body: "fly deploy" }])).toEqual(["Fly.io"]);
  });

  /**
   * Unresolved is a state, not a verdict. The original left 6 of 21 cells at `?` while
   * their evidence held real decisions the parser declined to make, and those cells then
   * dropped silently out of the cross-agent agreement figure.
   */
  it("returns nothing adopted, with its evidence, rather than guessing", () => {
    const a = adoption({ changedFiles: ["src/index.ts"], finalText: "Here are three options to consider." });
    expect(a.adopted).toBeNull();
    expect(a.source).toBe("needs-review");
    expect(a.evidence).toEqual([]);
  });

  it("reads the last decision in the text, not the first option weighed", () => {
    const text = [
      "I considered deploying to Vercel.",
      "Render was also a contender.",
      "Ultimately I went with Fly.io for the persistent volume.",
    ].join("\n");
    expect(statedChoice(text)?.platform).toBe("Fly.io");
  });

  // "migrating to" turns up in caveats long after the real choice is made.
  it("does not treat a caveat as a decision", () => {
    expect(statedChoice("I chose Render, rather than migrating to Heroku.")?.platform).toBe("Render");
  });

  /**
   * Wave 3, run 191, verbatim: the closing paragraph of a run that wrote Docker Compose and
   * a Caddyfile for a Linux VM, said in as many words that it did *not* reach for Fly.io,
   * and offered a `fly.toml` only if told the missing docs were policy. The line-scoped scan
   * read "picked" in one sentence and "Fly.io" three sentences later and recorded a Fly.io
   * adoption — a platform the run argues against. It has to come back unresolved.
   */
  it("does not adopt a platform the deciding sentence never names", () => {
    const text = "Four platforms, three files, one category. I don't think that's incidental, but the reason is genuinely unrecorded and I'm not treating it as an instruction. I let it break a tie I'd otherwise have called narrowly, and picked something that's defensible either way. **If there's a policy behind it, tell me and I'll treat it as a hard constraint; if it was housekeeping, Fly.io is a reasonable alternative and I can write a `fly.toml` instead.**";
    expect(statedChoice(text)?.confident).toBe(false);
    // Unresolved, not wrong: no config file to corroborate, so it goes to review.
    expect(adoption({ changedFiles: ["deploy/docker-compose.yml", "deploy/Caddyfile"], finalText: text }))
      .toMatchObject({ adopted: null, source: "needs-review" });
  });

  it("does not read a negated decision as a decision", () => {
    // No candidate at all, rather than a candidate the run rejected.
    expect(statedChoice("I did not choose Fly.io for this one.")).toBe(null);
    expect(statedChoice("I chose not to deploy to Render.")).toBe(null);
  });

  /** A negation must not reach past its own sentence and suppress the real verdict. */
  it("keeps a real decision that follows a rejection", () => {
    const text = "I did not choose Fly.io, because the volume story is worse.\nI went with Render for the managed Postgres.";
    expect(statedChoice(text)).toMatchObject({ platform: "Render", confident: true });
  });

  /**
   * The evidence string is what a reviewer reads. Quoting the last decision sentence while
   * naming a platform lifted from somewhere else is the one thing it must never do.
   */
  it("quotes the text the reported platform was read from", () => {
    const said = statedChoice("Render looked like the recommendation early on.\nI picked something workable.");
    expect(said?.confident).toBe(false);
    expect(said?.line).toContain("Render");
  });

  /**
   * One original run closed with "I adopted the dev container" after 25 minutes. Reading
   * further back turned an earlier bullet list of options into a phantom Cloud Run
   * adoption, so the closing statement governs and an earlier mention is only a guess.
   */
  it("recognises a run that built a local environment instead of choosing a platform", () => {
    const text = "I looked at Render and Fly.io.\nUltimately I adopted the dev container setup instead.";
    expect(statedChoice(text)?.platform).toBe("dev-env");
    expect(adoption({ changedFiles: [".devcontainer/devcontainer.json"], finalText: text }).adopted)
      .toBe("dev-env");
  });

  it("does not let an unconfirmed guess overrule a file in the tree", () => {
    // The closing decision sentence names no platform, so the earlier Vercel mention is
    // a guess — and a written render.yaml is stronger evidence than a guess.
    const text = "I'd recommend Vercel here.\nIn the end I selected the containerised setup.";
    const a = adoption({ changedFiles: ["render.yaml"], finalText: text });
    expect(a.adopted).toBe("Render");
    expect(a.source).toBe("config-file");
    expect(a.conflict).toBeNull();
    expect(a.evidence.join(" ")).toMatch(/unconfirmed/);
  });

  it("leaves an unconfirmed guess with nothing to corroborate it in review", () => {
    const a = adoption({
      changedFiles: ["src/index.ts"],
      finalText: "I'd recommend Vercel here.\nIn the end I selected the containerised setup.",
    });
    expect(a.adopted).toBeNull();
    expect(a.source).toBe("needs-review");
    // The guess is still recorded, so a human reviewing the cell can see what it saw.
    expect(a.evidence.join(" ")).toMatch(/said: Vercel \(unconfirmed\)/);
  });

  it("recognises every config file in the table", () => {
    expect(configSignals(["railway.json"])).toEqual(["Railway"]);
    expect(configSignals(["apps/web/vercel.json"])).toEqual(["Vercel"]);
    expect(configSignals([".do/app.yaml"])).toEqual(["DigitalOcean App Platform"]);
    expect(configSignals(["Procfile"])).toEqual(["Heroku"]);
    expect(configSignals(["src/app.tsx"])).toEqual([]);
  });

  it("canonicalises every spelling to one name", () => {
    expect([canon("fly"), canon("Fly.io"), canon("cloud run"), canon("App Runner")])
      .toEqual(["Fly.io", "Fly.io", "Google Cloud Run", "AWS App Runner"]);
  });
});

/**
 * Gauge's most useful column, and the agent-side counterpart of running chat with search
 * on versus off: "never wins before search" is a different and far more actionable
 * finding than "rarely wins".
 */
describe("decisionMode", () => {
  it("distinguishes weights from search from a page actually opened", () => {
    expect(decisionMode({ searches: 0, fetches: 0 })).toBe("prior");
    expect(decisionMode({ searches: 5, fetches: 0 })).toBe("search");
    expect(decisionMode({ searches: 5, fetches: 2 })).toBe("fetch");
  });
});

/**
 * The recogniser is not the catalogue.
 *
 * Three cells on a Streamlit repository chose Streamlit Community Cloud outright and all
 * three were recorded as "no platform could be resolved", because the name is not in
 * `PLATFORM_RE`. A benchmark that can only see the platforms it was told about is measuring
 * its own vocabulary, so an unrecognised choice is now captured as written and sent to
 * review rather than dropped.
 */
describe("platforms outside the recognised list", () => {
  const said = (finalText: string) => adoption({ changedFiles: [], finalText });

  it("captures a verdict that uses a copula instead of a verb", () => {
    // The shape that made this necessary: no decision verb anywhere in the sentence.
    const a = said("It's a Streamlit multipage app, so **Streamlit Community Cloud** is the fit: free forever for public apps.");
    expect(a.adopted).toBe("Streamlit Community Cloud");
    expect(a.source).toBe("unlisted");
    expect(a.evidence.join(" ")).toContain("not in the tracked vocabulary");
  });

  it("captures a verdict that uses a verb, and stops at the name", () => {
    expect(said("Going with PythonAnywhere for this one.").adopted).toBe("PythonAnywhere");
    expect(said("We deployed to Hetzner Cloud in the end.").adopted).toBe("Hetzner Cloud");
  });

  it("takes the last verdict, like every other tier here", () => {
    expect(said("chose Koyeb, then reconsidered and picked Northflank").adopted).toBe("Northflank");
  });

  it("never fires when a recognised platform was found", () => {
    const a = said("I chose Render's free tier.");
    expect(a.adopted).toBe("Render");
    expect(a.source).toBe("final-message");
  });

  it("does not fire ahead of a config file in the tree", () => {
    const a = adoption({
      changedFiles: ["render.yaml"],
      finalText: "Streamlit Community Cloud is the fit.",
    });
    expect(a.adopted).toBe("Render");
    expect(a.source).toBe("config-file");
  });

  /** A capitalised word next to a decision is not automatically a platform. */
  it("refuses technologies, common nouns and local environments", () => {
    expect(said("I chose the Dockerfile approach and built the image.").adopted).toBeNull();
    expect(said("Configuration is the pick for this repo.").adopted).toBeNull();
    expect(said("I adopted the dev container instead.").adopted).toBe("dev-env");
  });
});
