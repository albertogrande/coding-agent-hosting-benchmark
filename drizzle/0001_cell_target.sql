DROP INDEX `cells_unique`;--> statement-breakpoint
ALTER TABLE `cells` ADD `target` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cells_unique` ON `cells` (`wave_id`,`prompt_id`,`wave_surface_id`,`target`);