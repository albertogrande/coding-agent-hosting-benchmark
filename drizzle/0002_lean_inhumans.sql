ALTER TABLE `runs` ADD `search_queries` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `tool_errors` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `tool_timeline` text DEFAULT '[]' NOT NULL;