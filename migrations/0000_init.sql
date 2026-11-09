CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`latency_ms` integer,
	`status` text NOT NULL,
	`error` text,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`label` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source` text DEFAULT 'careers_site' NOT NULL,
	`source_posting_id` text,
	`stage` text DEFAULT 'Applied' NOT NULL,
	`owner_id` text,
	`ai_fit` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_candidate_job` ON `applications` (`candidate_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_job_stage` ON `applications` (`job_id`,`stage`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`diff` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`department` text NOT NULL,
	`job_id` text,
	`audience_rule` text NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`opens` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`reapplies` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`city` text,
	`exp_years` text,
	`notice` text,
	`linkedin_url` text,
	`cv_key` text,
	`cv_text` text,
	`pitch` text,
	`parsed_profile` text,
	`human_only_review` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_email_unique` ON `candidates` (`email`);--> statement-breakpoint
CREATE TABLE `channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_ref` text NOT NULL,
	`display_name` text NOT NULL,
	`scopes` text,
	`token_enc` text,
	`refresh_enc` text,
	`key_version` integer DEFAULT 1 NOT NULL,
	`config` text,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_ok_at` integer,
	`connected_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conn_expires` ON `channel_connections` (`expires_at`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`accent` text DEFAULT '#F59A3C' NOT NULL,
	`logo_key` text,
	`careers_domain` text,
	`linkedin_org_urn` text,
	`profile` text NOT NULL,
	`require_approval` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_unique` ON `companies` (`slug`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`candidate_id` text,
	`type` text NOT NULL,
	`interests` text,
	`frequency` text,
	`source` text,
	`granted_at` integer NOT NULL,
	`withdrawn_at` integer
);
--> statement-breakpoint
CREATE INDEX `consents_email` ON `consents` (`email`);--> statement-breakpoint
CREATE TABLE `distribution_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`department` text,
	`connection_ids` text NOT NULL,
	`auto_publish` integer DEFAULT false NOT NULL,
	`require_preview` integer DEFAULT true NOT NULL,
	`repost_every_days` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`frequency` text NOT NULL,
	`unsub_token` text NOT NULL,
	`last_sent_at` integer,
	`created_at` integer NOT NULL,
	`stopped_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_alerts_unsub_token_unique` ON `job_alerts` (`unsub_token`);--> statement-breakpoint
CREATE TABLE `job_stats_daily` (
	`job_id` text NOT NULL,
	`date` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`clicks_by_source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_stats_pk` ON `job_stats_daily` (`job_id`,`date`);--> statement-breakpoint
CREATE TABLE `job_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`sections` text NOT NULL,
	`source` text DEFAULT 'human' NOT NULL,
	`ai_run_id` text,
	`author_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_job_version` ON `job_versions` (`job_id`,`version`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`department` text NOT NULL,
	`location` text NOT NULL,
	`work_mode` text NOT NULL,
	`shift` text NOT NULL,
	`exp_label` text NOT NULL,
	`exp_band` integer NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text DEFAULT 'INR',
	`show_salary` integer DEFAULT false NOT NULL,
	`incentive` integer DEFAULT false NOT NULL,
	`tags` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`owner_id` text,
	`hiring_manager_id` text,
	`posted_at` integer,
	`closes_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hiring_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_company_status` ON `jobs` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_status_posted` ON `jobs` (`status`,`posted_at`);--> statement-breakpoint
CREATE TABLE `post_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`provider` text NOT NULL,
	`variant` integer DEFAULT 1 NOT NULL,
	`text` text NOT NULL,
	`hashtags` text,
	`image_key` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`posting_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`copy_id` text,
	`run` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`external_id` text,
	`external_url` text,
	`scheduled_at` integer,
	`published_at` integer,
	`closed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_idem` ON `postings` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `postings_status_sched` ON `postings` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `postings_job` ON `postings` (`job_id`);--> statement-breakpoint
CREATE TABLE `stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`by_user` text,
	`note` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'recruiter' NOT NULL,
	`company_ids` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`event` text NOT NULL,
	`status` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`url` text NOT NULL,
	`secret_enc` text NOT NULL,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
