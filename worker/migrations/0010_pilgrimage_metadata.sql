ALTER TABLE trips ADD COLUMN trip_type TEXT NOT NULL DEFAULT 'standard' CHECK(trip_type IN ('standard','pilgrimage'));
ALTER TABLE trips ADD COLUMN related_work TEXT NOT NULL DEFAULT '';
