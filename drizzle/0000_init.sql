CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`ocid` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`ok` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alerts_sent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_sent_kind_ref` ON `alerts_sent` (`kind`,`ref`);--> statement-breakpoint
CREATE TABLE `bid_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bid_id` integer NOT NULL,
	`group` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`form_type` text,
	`vault_kind` text,
	`done` integer DEFAULT false NOT NULL,
	`form_data_json` text,
	`file_path` text,
	`pages` integer,
	`needs_signature` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_page` integer,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bid_registers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text,
	`job` text,
	`work_type` text,
	`year` integer,
	`source_file` text,
	`ocid` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocid` text NOT NULL,
	`stage` text NOT NULL,
	`started_at` integer NOT NULL,
	`submitted_at` integer,
	`submit_method` text,
	`final_price_cents` integer,
	`result` text,
	`winner_name` text,
	`winning_price_cents` integer,
	`result_recorded_at` integer,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bids_ocid_unique` ON `bids` (`ocid`);--> statement-breakpoint
CREATE TABLE `buyers` (
	`buyer_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`province` text,
	`confirmed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text,
	`initials` text,
	`registration_number` text,
	`csd_number` text,
	`tax_pin` text,
	`vat_registered` integer DEFAULT false NOT NULL,
	`vat_number` text,
	`address` text,
	`contact_person` text,
	`phone` text,
	`email` text,
	`province` text,
	`black_ownership_pct` integer,
	`women_ownership_pct` integer,
	`youth_owned` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fetch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`window_from` text,
	`window_to` text,
	`fetched` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`errors_json` text
);
--> statement-breakpoint
CREATE TABLE `func_criteria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocid` text NOT NULL,
	`name` text NOT NULL,
	`points` integer,
	`evidence` text,
	`source_page` integer,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pricing_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bid_id` integer NOT NULL,
	`label` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `register_bids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`register_id` integer NOT NULL,
	`bidder` text,
	`price_cents` integer,
	`won` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`register_id`) REFERENCES `bid_registers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`alert_email` text,
	`alert_mode` text DEFAULT 'instant' NOT NULL,
	`alert_on_changes` integer DEFAULT true NOT NULL,
	`saved_filters_json` text
);
--> statement-breakpoint
CREATE TABLE `specific_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocid` text NOT NULL,
	`name` text NOT NULL,
	`points` integer,
	`profile_field` text,
	`source_page` integer,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tender_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocid` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`source` text,
	`detected_at` integer NOT NULL,
	`seen_at` integer,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tender_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocid` text NOT NULL,
	`source_id` text,
	`title` text,
	`format` text,
	`url` text,
	`local_path` text,
	`pdf_path` text,
	`pages` integer,
	`belongs_check` text DEFAULT 'unknown' NOT NULL,
	`downloaded_at` integer,
	FOREIGN KEY (`ocid`) REFERENCES `tenders`(`ocid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenders` (
	`ocid` text PRIMARY KEY NOT NULL,
	`etender_id` text,
	`reference` text,
	`title` text,
	`short_title` text,
	`description` text,
	`buyer_id` text,
	`entity` text,
	`province` text,
	`province_source` text,
	`work_type` text,
	`tender_type` text,
	`relevant` integer,
	`relevance_reason` text,
	`closes_at` integer,
	`published_at` integer,
	`briefing_at` integer,
	`briefing_where` text,
	`briefing_compulsory` integer,
	`submit_method` text,
	`submit_where` text,
	`submit_copies` text,
	`func_threshold` integer,
	`preference_system` text,
	`first_seen_at` integer,
	`opened_at` integer,
	`cancelled` integer DEFAULT false NOT NULL,
	`raw_json` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `vault_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`file_path` text,
	`issued_at` integer,
	`expires_at` integer,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_documents_kind_unique` ON `vault_documents` (`kind`);