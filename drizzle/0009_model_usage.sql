CREATE TABLE "model_usage" (
	"model" text PRIMARY KEY NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"day_spent" integer NOT NULL
);
