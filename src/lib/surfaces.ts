/**
 * The surface registry, with no dependencies.
 *
 * Surface keys are written into `wave_surfaces` at plan time and read back by the runner,
 * the grader and every derive. They therefore need one definition that all three can see —
 * and the storage layer must be able to reject a typo without importing provider SDKs, or a
 * misspelled key survives planning and fails at run 300 of an overnight wave.
 *
 * `src/runner/surfaces/index.ts` is checked against this list by a test, so an adapter
 * added there without an entry here fails the suite rather than the wave.
 */

export const SURFACE_KEYS = [
  "chat.api.anthropic",
  "chat.api.openai",
  "chat.cli.claude",
  "chat.cli.codex",
  "agent.repo.claude",
  "agent.repo.codex",
] as const;

export type SurfaceKey = (typeof SURFACE_KEYS)[number];

const KNOWN = new Set<string>(SURFACE_KEYS);

export const isKnownSurface = (key: string): key is SurfaceKey => KNOWN.has(key);

/**
 * An agent surface is graded on what it committed to in code; a chat surface on what it
 * said. Same table, different question, and the prefix is what routes between them.
 */
export const isAgentSurface = (key: string): boolean => key.startsWith("agent.");

/**
 * A CLI surface reads pages only when it chooses to open one, so a run that searched and
 * fetched nothing is a real decision — the earlier agent work found one engine deciding
 * from search snippets across 45 runs without opening a page. On an API surface the
 * provider returns what it consulted, so the same shape means the adapter lost it.
 *
 * The distinction decides whether missing sources are a finding or a fault, which is why
 * it lives here rather than being re-derived from a key prefix at each call site.
 */
export const reportsSourcesWhenSearching = (key: string): boolean => key.startsWith("chat.api.");
