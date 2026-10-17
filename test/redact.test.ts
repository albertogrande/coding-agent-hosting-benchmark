import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/agent-transcripts.json";
import { PLATFORM_ALIASES, statedChoice } from "@/derive/adoption";
import { redact } from "@/lib/redact";

/**
 * The published record is read by strangers, and two things in it belong to people who
 * never agreed to be in the experiment. These tests fix the shape of what leaves and,
 * just as much, of what stays: the text is the grader's input, so a redaction that eats a
 * platform name changes a published figure.
 */
describe("redact", () => {
  it("takes the password out of a generated sandbox login", () => {
    const r = redact("log in as `admin` / `k3Xq-2f8Lp` (also in `.env`, mode 600).");
    expect(r.text).toBe("log in as `admin` / `[REDACTED]` (also in `.env`, mode 600).");
    expect(r.count).toBe(1);
  });

  it("takes it out of the admin@localhost spelling too", () => {
    expect(redact("(`admin@localhost` / `7cdd12ab`)").text).toBe("(`admin@localhost` / `[REDACTED]`)");
  });

  it("takes a labelled secret only when the value is long enough to be one", () => {
    expect(redact("API_KEY: `sk-ci0Z8vv1nQ2mWx7bT4pL`").text).toBe("API_KEY: `[REDACTED]`");
    expect(redact("password: `short`").text).toBe("password: `short`");
  });

  it("keeps the domain when it redacts an address, because platform names live there", () => {
    const r = redact("mail goes to noreply@github.com for now");
    expect(r.text).toBe("mail goes to [REDACTED]@github.com for now");
    expect(r.text).toContain("github.com");
  });

  it("takes the name with the address in a git identity", () => {
    const r = redact("authored it with the identity from your existing commit (`matt ferrante <mferrante3@gmail.com>`)");
    expect(r.text).toBe("authored it with the identity from your existing commit (`[REDACTED] <[REDACTED]@gmail.com>`)");
    expect(r.text).not.toContain("ferrante");
    expect(r.count).toBe(1);
  });

  it("leaves documentation placeholders alone, so a placeholder still reads as one", () => {
    expect(redact("set ADMIN_EMAIL=you@example.com").text).toBe("set ADMIN_EMAIL=you@example.com");
    expect(redact("admin@localhost signs in").text).toBe("admin@localhost signs in");
    expect(redact("root@db.example.org").text).toBe("root@db.example.org");
  });

  it("is idempotent, so re-publishing a redacted record redacts nothing twice", () => {
    const once = redact("(`matt ferrante <mferrante3@gmail.com>`) and `admin` / `k3Xq-2f8Lp`");
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });

  it("touches nothing in a run that carries neither, and says so with a zero", () => {
    const text = "## Platform: Render, via Blueprint\n\nrender.yaml, committed on branch deploy/render.";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(r.count).toBe(0);
  });

  it("handles an empty or missing message without inventing one", () => {
    expect(redact(null)).toEqual({ text: "", count: 0 });
    expect(redact("")).toEqual({ text: "", count: 0 });
  });
});

/**
 * The reason redaction keeps domains and takes only the identifying half. The published
 * closing message is the grader's input — the whole fast reproduce path is `load`, then
 * `grade --regrade` over this text — so a redaction that ate a platform name would move a
 * published figure and make the record disagree with the store it came from.
 *
 * Verified once against the real wave-3 record on 11 September, where the regrade before
 * and after redaction was identical line for line. This is that check, standing.
 */
describe("redaction and the grader", () => {
  const texts = (fixtures as { prose: string }[]).map((f) => f.prose);

  it("never moves a stated choice on the regression corpus", () => {
    const moved = texts
      .map((prose) => ({ before: statedChoice(prose)?.platform ?? null, after: statedChoice(redact(prose).text)?.platform ?? null }))
      .filter(({ before, after }) => before !== after);
    expect(moved).toEqual([]);
  });

  it("leaves every platform spelling standing, which is the property the rest rests on", () => {
    const spellings = Object.values(PLATFORM_ALIASES).flat();
    const lost = texts.flatMap((prose) => {
      const after = redact(prose).text;
      return spellings
        .filter((a) => prose.toLowerCase().includes(a.toLowerCase()) && !after.toLowerCase().includes(a.toLowerCase()))
        .map((a) => `${a} disappeared from a run`);
    });
    expect(lost).toEqual([]);
  });

  it("keeps a platform that only ever appeared inside an address", () => {
    const prose = "Deployed. CI mail goes to ci-bot@pages.github.com; platform is GitHub Pages.";
    expect(statedChoice(redact(prose).text)?.platform).toBe(statedChoice(prose)?.platform);
  });
});
