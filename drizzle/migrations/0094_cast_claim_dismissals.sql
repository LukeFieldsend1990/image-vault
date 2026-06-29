CREATE TABLE `cast_claim_dismissals` (
  `id` text PRIMARY KEY NOT NULL,
  `talent_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `cast_id` text NOT NULL REFERENCES `production_cast`(`id`) ON DELETE CASCADE,
  `dismissed_at` integer NOT NULL
);
CREATE UNIQUE INDEX `cast_claim_dismissals_talent_cast_unique` ON `cast_claim_dismissals` (`talent_id`, `cast_id`);
