CREATE TABLE "upstream_calls" (
	"source" text PRIMARY KEY NOT NULL,
	"minute_start" timestamp with time zone NOT NULL,
	"minute_count" integer NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"day_count" integer NOT NULL
);
