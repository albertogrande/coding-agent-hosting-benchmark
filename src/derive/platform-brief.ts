/**
 * The "for a platform" reading of an agent wave: what one platform in the catalogue can act
 * on. How often the agent named it and how often it committed to it, the frame under which
 * it wins most and the one under which it loses most, and the sentences the agent wrote in
 * the runs where it weighed the platform and chose another.
 *
 * The chart and the grid answer "who won"; this answers "why not you", which is the
 * number a platform's team can do something about. Every figure here is a pure function
 * over stored rows and the benchmark already derived from them; the quotes are verbatim
 * sentences from closing messages, each with the run it came from.
 */
import type { Alias } from "@/db/schema";
import { isGradeable, type AgentBenchmark, type AgentRow } from "./agent-benchmark";
import { platformPatterns } from "./grade";

export type FrameShare = {
  frame: string;
  gradeable: number;
  adopted: number;
  named: number;
  /** adopted / gradeable in this frame. */
  share: number;
};

/** A sentence from a run that named the platform and committed to another. */
export type LostQuote = {
  runId: number;
  target: string;
  frame: string;
  /** What the run committed to instead. */
  adopted: string;
  sentence: string;
};

export type PlatformBrief = {
  platform: string;
  named: number;
  adopted: number;
  share: number;
  presence: number;
  byFrame: FrameShare[];
  /** The frame with the highest adoption share; null when the platform was adopted nowhere. */
  winsMost: FrameShare | null;
  /** The lowest share among frames where it was named at all; null when it was named nowhere. */
  losesMost: FrameShare | null;
  /** Runs that named the platform and committed to another. */
  lostTo: number;
  quotes: LostQuote[];
};

export const QUOTE_MAX_CHARS = 240;
export const QUOTES_PER_PLATFORM = 3;

/** Sentences of a closing message: split on ". " and on newlines, trimmed, empties dropped. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const cap = (s: string, max = QUOTE_MAX_CHARS): string => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The sentence a run used about a platform it did not choose: the last one that names both
 * the platform and what was adopted instead, because that is the comparison; failing that,
 * the last one that names the platform, because a closing message ends with its reasons.
 */
export function lostSentence(text: string, platform: RegExp, adopted: RegExp | null): string | null {
  // A table row or a heading names things without saying anything about them.
  const prose = sentencesOf(text).filter((s) => !/^[|#]/.test(s));
  const naming = prose.filter((s) => { platform.lastIndex = 0; return platform.test(s); });
  if (!naming.length) return null;
  const both = adopted ? naming.filter((s) => { adopted.lastIndex = 0; return adopted.test(s); }) : [];
  return cap(both.length ? both[both.length - 1] : naming[naming.length - 1]);
}

export function platformBriefs(rows: AgentRow[], b: AgentBenchmark, platforms: Alias[]): PlatformBrief[] {
  const gradeable = rows.filter(isGradeable);
  const patterns = new Map(platformPatterns(platforms).map((p) => [p.name, p.re]));
  // A platform outside the catalogue has no aliases; its name, as the agent used it, is the pattern.
  const patternOf = (name: string): RegExp =>
    patterns.get(name) ?? new RegExp(`(?<![\\w.])${escapeRe(name)}(?![\\w])`, "i");

  return b.adoption
    .filter((a) => a.listed && (a.named > 0 || a.adopted > 0))
    .map((a) => {
      const named = (r: AgentRow) => (r.platformsNamed ?? []).includes(a.platform);
      const byFrame: FrameShare[] = b.frames.map((frame) => {
        const here = gradeable.filter((r) => r.frame === frame);
        const adopted = here.filter((r) => r.adopted === a.platform).length;
        return { frame, gradeable: here.length, adopted, named: here.filter(named).length, share: here.length ? adopted / here.length : 0 };
      });
      const ran = byFrame.filter((f) => f.gradeable > 0);
      const winsMost = a.adopted > 0 ? ran.reduce((best, f) => (f.share > best.share ? f : best)) : null;
      const namedIn = ran.filter((f) => f.named > 0);
      const losesMost = namedIn.length ? namedIn.reduce((worst, f) => (f.share < worst.share ? f : worst)) : null;

      const lost = gradeable
        .filter((r) => named(r) && r.adopted && r.adopted !== a.platform)
        .sort((x, y) => x.runId - y.runId);
      const candidates: LostQuote[] = [];
      for (const r of lost) {
        const sentence = lostSentence(r.text ?? "", patternOf(a.platform), patternOf(r.adopted!));
        if (sentence) candidates.push({ runId: r.runId, target: r.target, frame: r.frame, adopted: r.adopted!, sentence });
      }
      // One quote per platform it lost to first, so three quotes show three rivals rather
      // than one rival three times; then the rest in run order.
      const quotes: LostQuote[] = [];
      const seen = new Set<string>();
      for (const c of candidates) {
        if (quotes.length >= QUOTES_PER_PLATFORM) break;
        if (!seen.has(c.adopted)) { seen.add(c.adopted); quotes.push(c); }
      }
      for (const c of candidates) {
        if (quotes.length >= QUOTES_PER_PLATFORM) break;
        if (!quotes.includes(c)) quotes.push(c);
      }
      quotes.sort((x, y) => x.runId - y.runId);

      return {
        platform: a.platform,
        named: a.named,
        adopted: a.adopted,
        share: a.share,
        presence: a.presence,
        byFrame,
        winsMost,
        losesMost,
        lostTo: lost.length,
        quotes,
      };
    });
}
