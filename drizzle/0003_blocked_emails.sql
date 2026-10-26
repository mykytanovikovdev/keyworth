CREATE TABLE "blocked_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_email_lowercase" CHECK ("blocked_emails"."email" = lower("blocked_emails"."email"))
);
