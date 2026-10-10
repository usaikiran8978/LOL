-- Favourites: a member's private bookmark list of other profiles. Never visible to the favourited person.
CREATE TABLE user_favorites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id),
  CONSTRAINT user_favorites_not_self CHECK (user_id <> target_id)
);
CREATE INDEX user_favorites_user_created_idx ON user_favorites (user_id, created_at DESC, target_id);
-- Erasure deletes both directions; this supports the "where target_id = ?" side.
CREATE INDEX user_favorites_target_idx ON user_favorites (target_id);
