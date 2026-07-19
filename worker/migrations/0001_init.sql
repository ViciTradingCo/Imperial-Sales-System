-- EEC Automated Ledger — D1 schema (the live transactional store).
-- Shops are keyed by business name (the same key used across the Sheets
-- registry). Sales/intake mirror the columns the Sheets backup + market use.

CREATE TABLE IF NOT EXISTS inventory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  business   TEXT    NOT NULL,
  item       TEXT    NOT NULL,
  price      REAL    NOT NULL DEFAULT 0,
  stock      INTEGER NOT NULL DEFAULT 0,
  low_stock  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (business, item)
);
CREATE INDEX IF NOT EXISTS idx_inventory_business ON inventory (business);

CREATE TABLE IF NOT EXISTS sales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  business   TEXT    NOT NULL,
  ts         TEXT    NOT NULL,          -- ISO timestamp
  order_no   TEXT    NOT NULL,
  customer   TEXT,
  hold       TEXT,
  items      TEXT,                      -- "Name x2 @ $30, Other x1 @ $5"
  qty_total  INTEGER NOT NULL DEFAULT 0,
  total      REAL    NOT NULL DEFAULT 0,
  employee   TEXT,                      -- the character who rang it up
  discount   TEXT,
  status     TEXT    NOT NULL DEFAULT ''-- '' or 'VOIDED'
);
CREATE INDEX IF NOT EXISTS idx_sales_business ON sales (business);

CREATE TABLE IF NOT EXISTS intake (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business    TEXT    NOT NULL,
  ts          TEXT    NOT NULL,
  item        TEXT,
  vendor      TEXT,
  source_hold TEXT,
  num_items   INTEGER NOT NULL DEFAULT 0,
  price_per   REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_intake_business ON intake (business);
