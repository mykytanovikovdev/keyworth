-- Runs once, when the local Postgres container starts with an empty volume.
-- Mirrors the production roles in Neon:
--   keyworth_owner  owns the schema and runs migrations (the container's superuser here);
--   keyworth_app    is what the Worker connects as: data access only, no DDL.
-- The migrations grant keyworth_app its privileges, in every environment.

CREATE ROLE keyworth_app LOGIN PASSWORD 'keyworth_app';

-- A separate database for automated tests, so they can wipe tables freely.
CREATE DATABASE keyworth_test OWNER keyworth_owner;

GRANT CONNECT ON DATABASE keyworth TO keyworth_app;
GRANT CONNECT ON DATABASE keyworth_test TO keyworth_app;
