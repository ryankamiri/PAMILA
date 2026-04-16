import type Database from "better-sqlite3";

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_initial",
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY NOT NULL,
        office_name TEXT NOT NULL,
        office_address TEXT NOT NULL,
        office_lat REAL,
        office_lng REAL,
        target_start_primary TEXT NOT NULL,
        target_start_secondary TEXT NOT NULL,
        target_end TEXT NOT NULL,
        max_monthly_rent INTEGER NOT NULL,
        default_bedroom_filter TEXT NOT NULL,
        normal_stay_type TEXT NOT NULL,
        fallback_stay_type TEXT NOT NULL,
        ideal_commute_minutes INTEGER NOT NULL,
        acceptable_commute_minutes INTEGER NOT NULL,
        long_walk_minutes INTEGER NOT NULL,
        heavy_walk_minutes INTEGER NOT NULL,
        panic_mode_enabled INTEGER NOT NULL,
        ai_on_capture_enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL,
        source_url TEXT NOT NULL,
        canonical_source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        monthly_rent INTEGER,
        known_total_fees INTEGER,
        stay_type TEXT NOT NULL,
        bedroom_count REAL,
        bedroom_label TEXT,
        bathroom_type TEXT NOT NULL,
        kitchen TEXT NOT NULL,
        washer TEXT NOT NULL,
        furnished TEXT NOT NULL,
        availability_summary TEXT,
        earliest_move_in TEXT,
        latest_move_in TEXT,
        earliest_move_out TEXT,
        latest_move_out TEXT,
        month_to_month INTEGER NOT NULL,
        status TEXT NOT NULL,
        user_notes TEXT,
        next_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS listings_canonical_source_url_idx
        ON listings (canonical_source_url);
      CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);
      CREATE INDEX IF NOT EXISTS listings_source_idx ON listings (source);

      CREATE TABLE IF NOT EXISTS source_captures (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
        source TEXT NOT NULL,
        url TEXT NOT NULL,
        captured_title TEXT,
        captured_text TEXT,
        selected_text TEXT,
        visible_fields_json TEXT NOT NULL,
        thumbnail_candidates_json TEXT NOT NULL,
        page_hash TEXT,
        capture_method TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS source_captures_listing_id_idx
        ON source_captures (listing_id);
      CREATE INDEX IF NOT EXISTS source_captures_url_idx ON source_captures (url);

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        address TEXT,
        cross_streets TEXT,
        neighborhood TEXT,
        geography_category TEXT NOT NULL,
        lat REAL,
        lng REAL,
        source TEXT NOT NULL,
        confidence TEXT NOT NULL,
        is_user_confirmed INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS locations_listing_id_idx ON locations (listing_id);

      CREATE TABLE IF NOT EXISTS commute_estimates (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        total_minutes INTEGER,
        walk_minutes INTEGER,
        transfer_count INTEGER,
        route_summary TEXT,
        line_names_json TEXT NOT NULL,
        has_bus_heavy_route INTEGER NOT NULL,
        confidence TEXT NOT NULL,
        calculated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS commute_estimates_listing_id_idx
        ON commute_estimates (listing_id);

      CREATE TABLE IF NOT EXISTS score_breakdowns (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        total_score INTEGER NOT NULL,
        commute_score INTEGER NOT NULL,
        location_score INTEGER NOT NULL,
        price_score INTEGER NOT NULL,
        date_score INTEGER NOT NULL,
        amenity_score INTEGER NOT NULL,
        stay_bedroom_score INTEGER NOT NULL,
        hard_filter_status TEXT NOT NULL,
        hard_filter_reasons_json TEXT NOT NULL,
        score_explanation TEXT NOT NULL,
        cleanup_actions_json TEXT NOT NULL,
        risk_flags_json TEXT NOT NULL,
        calculated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS score_breakdowns_listing_id_idx
        ON score_breakdowns (listing_id);

      CREATE TABLE IF NOT EXISTS media_thumbnails (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        cached_path TEXT,
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_analyses (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
        input_hash TEXT NOT NULL,
        model TEXT,
        analysis_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ai_analyses_input_hash_idx ON ai_analyses (input_hash);

      CREATE TABLE IF NOT EXISTS status_events (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS status_events_listing_id_idx ON status_events (listing_id);

      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY NOT NULL,
        format TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  }
];

export function runMigrations(sqlite: Database.Database, migrations: Migration[] = MIGRATIONS) {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = sqlite.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>;
  const appliedIds = new Set(applied.map((migration) => migration.id));
  const insert = sqlite.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  const applyMigration = sqlite.transaction((migration: Migration) => {
    sqlite.exec(migration.sql);
    insert.run(migration.id, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!appliedIds.has(migration.id)) {
      applyMigration(migration);
    }
  }
}
