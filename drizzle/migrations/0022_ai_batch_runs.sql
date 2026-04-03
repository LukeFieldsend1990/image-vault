CREATE TABLE `ai_batch_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `trigger_type` text NOT NULL,
  `status` text NOT NULL,
  `initiated_by_user_id` text,
  `initiated_by_email` text,
  `reps_targeted` integer,
  `reps_processed` integer,
  `suggestions_created` integer NOT NULL DEFAULT 0,
  `skipped` text,
  `error` text,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`initiated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
