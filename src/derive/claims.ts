/**
 * Claims: a number, and the query that produces it.
 *
 * The rule this enforces is that a published figure has to be re-derivable from stored
 * rows on demand. The project this app came from stated the rule ("every claim must be
 * checkable on this site"), warned at build time when a claim went stale, and still
 * shipped a footnote citing a scan that existed in no dataset — because a warning is
 * something you can scroll past.
 *
 * Here a claim that cannot be derived fails the publish.
 */
export type Claim = {
  /** Stable id, so a page can point at the claim behind a sentence. */
  id: string;
  /** What the number means, in the words the report uses. */
  label: string;
  value: number | string;
  /** How it was computed, as text a reader can act on. */
  derivation: string;
  /** How many stored rows it was computed from. Zero is a failure, not a zero. */
  support: number;
};

export type ClaimFailure = { id: string; reason: string };

/**
 * Checks every claim before it is written out.
 *
 * A claim resting on no rows is the failure mode that matters: it is what a figure looks
 * like after the query behind it stops matching anything, and it renders as a confident
 * "0" rather than as an error.
 */
export function verifyClaims(claims: Claim[]): ClaimFailure[] {
  const failures: ClaimFailure[] = [];
  const seen = new Set<string>();

  for (const c of claims) {
    if (seen.has(c.id)) failures.push({ id: c.id, reason: "duplicate claim id" });
    seen.add(c.id);

    if (c.support <= 0) {
      failures.push({
        id: c.id,
        reason: `no rows support this claim — "${c.label}" would render as ${c.value} with nothing behind it`,
      });
    }
    if (!c.derivation.trim()) {
      failures.push({ id: c.id, reason: "no derivation recorded, so the number cannot be checked" });
    }
    if (typeof c.value === "number" && !Number.isFinite(c.value)) {
      failures.push({ id: c.id, reason: `value is ${c.value}, which is what a division by an empty set looks like` });
    }
  }
  return failures;
}
