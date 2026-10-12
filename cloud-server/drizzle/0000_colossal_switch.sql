CREATE TABLE `crm_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`accepted_by` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `crm_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_invites_token_hash_unique` ON `crm_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `crm_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `crm_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crm_snapshots` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `crm_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crm_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_workspaces_owner_id_unique` ON `crm_workspaces` (`owner_id`);