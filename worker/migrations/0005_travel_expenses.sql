CREATE TABLE IF NOT EXISTS travel_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount >= 0 AND amount <= 100000000),
  currency TEXT NOT NULL DEFAULT 'JPY',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_travel_expenses_user_trip_date
ON travel_expenses(user_id, trip_id, expense_date);