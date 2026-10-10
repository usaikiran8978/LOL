-- 0014 Millisecond timestamp precision.
-- JavaScript Date has millisecond resolution; microsecond timestamps don't round-trip through the API, which breaks
-- keyset cursors ("created_at < cursor") and read-marker comparisons for rows within the same millisecond.

DROP VIEW IF EXISTS likes, passes, super_likes;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.data_type = 'timestamp with time zone' AND t.table_type = 'BASE TABLE'
      AND (c.datetime_precision IS NULL OR c.datetime_precision > 3)
      AND c.table_name NOT LIKE 'analytics_events%'           -- partition key can't change type; not cursor-paginated
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz(3)', r.table_name, r.column_name);
  END LOOP;
END $$;

CREATE VIEW likes AS SELECT id, actor_id, target_id, surface, comment, created_at FROM swipe_actions WHERE action = 'like' AND rewound_at IS NULL;
CREATE VIEW passes AS SELECT id, actor_id, target_id, surface, created_at FROM swipe_actions WHERE action = 'pass' AND rewound_at IS NULL;
CREATE VIEW super_likes AS SELECT id, actor_id, target_id, surface, comment, created_at FROM swipe_actions WHERE action = 'super_like' AND rewound_at IS NULL;
