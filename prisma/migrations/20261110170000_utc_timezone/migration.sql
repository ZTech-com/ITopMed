-- All timestamps are stored as UTC in 'timestamp without time zone' columns.
-- Pin the database session time zone so now()/CURRENT_TIMESTAMP defaults are UTC
-- regardless of the host operating system's locale.
DO $fn$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database()); END $fn$;
