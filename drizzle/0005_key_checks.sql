-- Key slots made before this migration have no check value. Nothing could
-- create them yet (the first screen that does comes in phase 3.3), so there
-- should be none; if there are, stop here rather than leave keys that cannot
-- be verified. Locally: empty the table and migrate again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user_key_slots") THEN
    RAISE EXCEPTION 'user_key_slots has rows made before key checks existed';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "user_key_checks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"iv" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "key_check_version" CHECK ("user_key_checks"."version" = 1),
	CONSTRAINT "key_check_iv_length" CHECK (octet_length("user_key_checks"."iv") = 12),
	CONSTRAINT "key_check_tag_length" CHECK (octet_length("user_key_checks"."tag") = 16)
);
--> statement-breakpoint
ALTER TABLE "user_key_slots" ADD COLUMN "version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_key_checks" ADD CONSTRAINT "user_key_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_key_slots" ADD CONSTRAINT "key_slot_version" CHECK ("user_key_slots"."version" = 1);