/**
 * Reads a prompt set from JSON.
 *
 * Accepts two shapes: a plain list, and the richer form the AEO project used, where the
 * set carries its own design record — the decisions it made, the factors it varies, and
 * the limits it already knows about. That record is imported rather than discarded,
 * because a set that cannot say why it excludes a prompt shape cannot defend the numbers
 * it produces, and the limits are the honest half of the design.
 */
import type { Category } from "@/db/schema";

export type ImportedPrompt = {
  key: string;
  text: string;
  category?: string;
  topic?: string;
  intent?: string;
  shape?: string;
  branded: boolean;
  tags: string[];
  source: string;
  gapTarget?: string;
};

export type ImportedSet = {
  version: string;
  name: string;
  design: Record<string, unknown>;
  categories: Category[];
  prompts: ImportedPrompt[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A prompt that names the brand cannot measure whether the brand gets reached for. */
function looksBranded(text: string, brandAliases: string[]): boolean {
  return brandAliases.some((a) => a && new RegExp(`(?<![\\w.])${escapeRe(a)}(?![\\w])`, "i").test(text));
}

/**
 * Categories may arrive as an ordered array or as the object-of-objects the v6 set used.
 * Declaration order is kept either way: it is the demand ranking, and falling back to
 * alphabetical would quietly reorder every report built on it.
 */
function readCategories(raw: unknown): Category[] {
  if (Array.isArray(raw)) {
    return raw.map((c, i) =>
      typeof c === "string"
        ? { key: c, label: c, rank: i + 1 }
        : {
            key: str((c as Obj).key) ?? String(i),
            label: str((c as Obj).label) ?? str((c as Obj).name) ?? String(i),
            rank: i + 1,
          },
    );
  }
  if (isObj(raw)) {
    return Object.entries(raw).map(([key, v], i) => ({
      key,
      label: (isObj(v) ? (str(v.name) ?? str(v.label)) : undefined) ?? key,
      rank: i + 1,
    }));
  }
  return [];
}

export function importPromptSet(
  json: unknown,
  opts: { brandAliases?: string[]; name?: string } = {},
): ImportedSet {
  if (!isObj(json)) throw new Error("a prompt set must be a JSON object");
  const list = Array.isArray(json.prompts) ? json.prompts : null;
  if (!list?.length) throw new Error("no `prompts` array found in the file");

  const brandAliases = opts.brandAliases ?? [];
  const seen = new Set<string>();
  const prompts: ImportedPrompt[] = [];

  list.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const text = str(raw.prompt) ?? str(raw.text);
    if (!text) return;

    // Keys must be unique within a set: they are what makes the same prompt traceable
    // from one wave to the next, which is the whole point of re-running.
    let key = str(raw.id) ?? str(raw.key) ?? `p${i + 1}`;
    if (seen.has(key)) key = `${key}--${i + 1}`;
    seen.add(key);

    prompts.push({
      key,
      text,
      category: str(raw.category),
      topic: str(raw.topic),
      intent: str(raw.intent),
      shape: str(raw.shape),
      branded: typeof raw.branded === "boolean" ? raw.branded : looksBranded(text, brandAliases),
      tags: [str(raw.block), ...(Array.isArray(raw.tags) ? raw.tags.map(String) : [])].filter(
        Boolean,
      ) as string[],
      source: "imported",
      gapTarget: str(raw.gap_target) ?? str(raw.gapTarget),
    });
  });

  if (!prompts.length) throw new Error("every entry in `prompts` was missing its text");

  // The design travels with the set, `known_limits` included — those are the caveats the
  // set already knows it carries, and they belong next to the numbers, not in a README.
  const design: Record<string, unknown> = {
    ...(isObj(json.design) ? json.design : {}),
    ...(json.known_limits ? { known_limits: json.known_limits } : {}),
  };

  return {
    version: str(json.version) ?? "v1",
    name: opts.name ?? str(json.name) ?? `Imported set ${str(json.version) ?? ""}`.trim(),
    design,
    categories: readCategories(json.categories),
    prompts,
  };
}
