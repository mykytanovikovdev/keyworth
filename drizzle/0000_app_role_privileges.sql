-- The Worker connects as keyworth_app: it may read and change rows, never the
-- schema. The role itself is created outside migrations (worker/db/local/init.sql
-- locally, the Neon console in production); migrations only grant privileges.
-- Default privileges cover every table later migrations create, so new tables
-- need no grants of their own.
GRANT USAGE ON SCHEMA public TO keyworth_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keyworth_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO keyworth_app;
