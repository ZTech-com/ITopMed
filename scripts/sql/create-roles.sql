-- ============================================================================
-- ITop Med — database roles for a production PostgreSQL (16+).
-- Run ONCE as a superuser / cloud admin, BEFORE the first `prisma migrate deploy`:
--
--   psql "postgresql://<admin>@<host>/postgres" \
--     -v owner_password="$(secret owner)" -v app_password="$(secret app)" \
--     -v platform_password="$(secret platform)" -v portal_password="$(secret portal)" \
--     -f scripts/sql/create-roles.sql
--
-- Passwords come from the secret manager — never type them into shell history.
-- Mirrors scripts/lib/embedded-db.ts (dev/test). See docs/DEPLOYMENT.md.
-- ============================================================================
\set ON_ERROR_STOP on

-- Schema owner: used ONLY by migrations and backups. Never by the running app.
CREATE ROLE itopmed_owner LOGIN NOBYPASSRLS PASSWORD :'owner_password';
-- Runtime roles: no superuser, no BYPASSRLS, no CREATE. Row-Level Security applies.
CREATE ROLE itopmed_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE ROLE itopmed_platform LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'platform_password';
CREATE ROLE itopmed_portal LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'portal_password';

CREATE DATABASE itopmed OWNER itopmed_owner ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';
REVOKE ALL ON DATABASE itopmed FROM PUBLIC;
GRANT CONNECT ON DATABASE itopmed TO itopmed_app, itopmed_platform, itopmed_portal;

\connect itopmed
-- The migrations create btree_gist and pg_trgm (both "trusted"); the owner may create them.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE, USAGE ON SCHEMA public TO itopmed_owner;
-- Runtime table/function grants are created by the migrations themselves (deny by default).
