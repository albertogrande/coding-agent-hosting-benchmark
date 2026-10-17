/**
 * The repository layer. Pages and routes call these; nothing above this file imports
 * Drizzle or names a table, so the storage engine stays swappable.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { auditFindings, auditRuns, projects, type Alias, type Category, type Domain } from "./schema";
import type { Finding } from "@/runner/audit";

export type NewProject = {
  slug: string;
  name: string;
  /** Omitted for a category benchmark, which has no platform it is about. */
  brand?: Alias;
  competitors?: Alias[];
  domains?: Domain[];
  categories?: Category[];
};

export type Project = typeof projects.$inferSelect;

/**
 * Slugs are the URL identity, so they are normalised here rather than trusted from a
 * form: one rule, applied at the only door into the table.
 */
export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function createProject(db: Db, p: NewProject): Project {
  const slug = slugify(p.slug || p.name);
  if (!slug) throw new Error("a project needs a name that contains at least one letter or digit");
  return db.insert(projects).values({
    slug,
    name: p.name,
    brand: p.brand ?? null,
    competitors: p.competitors ?? [],
    domains: p.domains ?? [],
    categories: p.categories ?? [],
  }).returning().get();
}

/**
 * Every platform in the field, focal row included when there is one.
 *
 * Most callers want this rather than `[project.brand, ...project.competitors]`, which is the
 * shape that assumed a project always has a subject.
 */
export function platformsOf(p: Pick<Project, "brand" | "competitors">): Alias[] {
  return p.brand ? [p.brand, ...p.competitors] : p.competitors;
}

export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
}

export function getProject(db: Db, slug: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.slug, slug)).get();
}

export function updateProject(db: Db, id: number, patch: Partial<NewProject>): Project {
  const values: Record<string, unknown> = {};
  for (const k of ["name", "brand", "competitors", "domains", "categories"] as const) {
    if (patch[k] !== undefined) values[k] = patch[k];
  }
  if (patch.slug !== undefined) values.slug = slugify(patch.slug);
  if (!Object.keys(values).length) return db.select().from(projects).where(eq(projects.id, id)).get()!;
  return db.update(projects).set(values).where(eq(projects.id, id)).returning().get();
}

export function deleteProject(db: Db, id: number): void {
  db.delete(projects).where(eq(projects.id, id)).run();
}

// ---------------------------------------------------------------- audits

export type AuditRun = typeof auditRuns.$inferSelect;
export type AuditFinding = typeof auditFindings.$inferSelect;

/**
 * Stores one audit as a run plus its findings, snapshotting the domain list it was taken
 * against — so an audit stays readable after the project's domains change under it.
 */
export function saveAudit(db: Db, projectId: number, domains: Domain[], findings: Finding[]): AuditRun {
  const run = db.insert(auditRuns).values({ projectId, config: { domains } }).returning().get();
  if (findings.length) {
    db.insert(auditFindings).values(findings.map((f) => ({ ...f, auditRunId: run.id }))).run();
  }
  return run;
}

export function latestAudit(db: Db, projectId: number): { run: AuditRun; findings: AuditFinding[] } | undefined {
  const run = db.select().from(auditRuns)
    .where(eq(auditRuns.projectId, projectId))
    .orderBy(desc(auditRuns.ranAt), desc(auditRuns.id))
    .get();
  if (!run) return undefined;
  return { run, findings: db.select().from(auditFindings).where(eq(auditFindings.auditRunId, run.id)).all() };
}

export function listAudits(db: Db, projectId: number): AuditRun[] {
  return db.select().from(auditRuns)
    .where(eq(auditRuns.projectId, projectId))
    .orderBy(desc(auditRuns.ranAt), desc(auditRuns.id))
    .all();
}

export function auditFindingsFor(db: Db, auditRunId: number): AuditFinding[] {
  return db.select().from(auditFindings).where(eq(auditFindings.auditRunId, auditRunId)).all();
}
