CREATE TABLE `audit_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_run_id` integer NOT NULL,
	`target` text NOT NULL,
	`check` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`audit_run_id`) REFERENCES `audit_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_findings_run` ON `audit_findings` (`audit_run_id`);--> statement-breakpoint
CREATE TABLE `audit_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`ran_at` integer DEFAULT (unixepoch()) NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cells` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wave_id` integer NOT NULL,
	`prompt_id` integer NOT NULL,
	`wave_surface_id` integer NOT NULL,
	`planned_reps` integer NOT NULL,
	FOREIGN KEY (`wave_id`) REFERENCES `waves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wave_surface_id`) REFERENCES `wave_surfaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cells_unique` ON `cells` (`wave_id`,`prompt_id`,`wave_surface_id`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`grader_version` text NOT NULL,
	`stance` text NOT NULL,
	`brand_rank` integer,
	`winner` text,
	`platforms_named` text DEFAULT '[]' NOT NULL,
	`caveat` integer DEFAULT false NOT NULL,
	`evidence` text,
	`decision_mode` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`review_note` text,
	`reviewed_at` integer,
	`graded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_run_version` ON `grades` (`run_id`,`grader_version`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`brand` text NOT NULL,
	`competitors` text NOT NULL,
	`domains` text DEFAULT '[]' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `prompt_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`design` text DEFAULT '{}' NOT NULL,
	`supersedes_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_sets_project_version` ON `prompt_sets` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`key` text NOT NULL,
	`category` text,
	`topic` text,
	`intent` text,
	`shape` text,
	`text` text NOT NULL,
	`branded` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`gap_target` text,
	FOREIGN KEY (`set_id`) REFERENCES `prompt_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompts_set_key` ON `prompts` (`set_id`,`key`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cell_id` integer NOT NULL,
	`rep` integer NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`model_resolved` text,
	`raw_response` text,
	`text` text,
	`stop_reason` text,
	`truncated` integer DEFAULT false NOT NULL,
	`search_count` integer,
	`search_unit` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd_micros` integer,
	`duration_ms` integer,
	`error` text,
	`ran_at` integer DEFAULT (unixepoch()) NOT NULL,
	`imported_from` text,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_cell_rep` ON `runs` (`cell_id`,`rep`);--> statement-breakpoint
CREATE INDEX `runs_cell` ON `runs` (`cell_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`url` text NOT NULL,
	`host` text,
	`title` text,
	`rank` integer,
	`kind` text DEFAULT 'citation' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_run` ON `sources` (`run_id`);--> statement-breakpoint
CREATE TABLE `wave_surfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wave_id` integer NOT NULL,
	`surface_key` text NOT NULL,
	`label` text NOT NULL,
	`model_requested` text,
	`reps` integer DEFAULT 1 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`wave_id`) REFERENCES `waves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wave_surfaces_unique` ON `wave_surfaces` (`wave_id`,`surface_key`,`label`);--> statement-breakpoint
CREATE TABLE `waves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`prompt_set_id` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`cost_cap_usd` integer,
	`notes` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_set_id`) REFERENCES `prompt_sets`(`id`) ON UPDATE no action ON DELETE no action
);
