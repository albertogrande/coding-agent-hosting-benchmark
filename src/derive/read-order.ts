/**
 * Whether a run read the web before or after it committed to a platform.
 *
 * "Decided from prior knowledge" leaves a gap the other way round: a run that read pages may
 * have read them only to write a config it had already chosen. The tool timeline is ordered,
 * so the gap is measurable. The commitment is the first call that writes the chosen
 * platform's config file (`render.yaml`, `fly.toml`, ...), by the Write or Edit tool or by a
 * shell redirect. A read is a web search, a page fetch, or a web lookup from the shell.
 *
 * A platform with no config file of its own (a VM, GitHub Pages, Streamlit Community Cloud)
 * has no such moment, and a run that never wrote one is `unknown` rather than guessed at.
 */
import { CONFIG_FILES } from "./adoption";
import { shellLookups } from "./shell-lookups";

export type ReadOrder = "no reads" | "read before committing" | "read only after committing" | "unknown";

type Event = { tool: string; detail?: string };

const isRead = (e: Event) =>
  e.tool === "WebSearch" || e.tool === "WebFetch" || (e.tool === "Bash" && shellLookups([e.detail ?? ""]).length > 0);

/** True when this call writes a config file that names `platform`. */
function writesConfig(e: Event, platform: string): boolean {
  const files = CONFIG_FILES.filter(([, p]) => p === platform).map(([re]) => re);
  if (!files.length) return false;
  const d = e.detail ?? "";
  if (e.tool === "Write" || e.tool === "Edit" || e.tool === "MultiEdit") return files.some((re) => re.test(d));
  if (e.tool !== "Bash") return false;
  // `cat > render.yaml <<EOF`, `tee fly.toml`, `> /work/repo/fly.toml`
  const targets = [...d.matchAll(/(?:>>?|\btee(?:\s+-a)?)\s*['"]?([^\s'";|&<>]+)/g)].map((m) => m[1]);
  return targets.some((t) => files.some((re) => re.test(t)));
}

export function readOrder(timeline: Event[], adopted: string | null): ReadOrder {
  const reads = timeline.map((e, i) => (isRead(e) ? i : -1)).filter((i) => i >= 0);
  if (!reads.length) return "no reads";
  if (!adopted) return "unknown";
  const commit = timeline.findIndex((e) => writesConfig(e, adopted));
  if (commit === -1) return "unknown";
  return reads[0] < commit ? "read before committing" : "read only after committing";
}
