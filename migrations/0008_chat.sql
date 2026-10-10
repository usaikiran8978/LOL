-- 0008 Conversations, messages, media, reactions, calls.
-- BRD §11; TECH §4 (conversations, conversation_members, messages, message_media), §10 (realtime messaging).

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('match','event')),
  match_id        uuid UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  event_id        uuid,                 -- FK added in 0010
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','locked_by_moderation')),
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'match' AND match_id IS NOT NULL) OR (kind = 'event' AND event_id IS NOT NULL))
);

CREATE TABLE conversation_members (
  conversation_id      uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 text NOT NULL DEFAULT 'member' CHECK (role IN ('member','host')),
  joined_at            timestamptz NOT NULL DEFAULT now(),
  left_at              timestamptz,
  last_delivered_message_id uuid,
  last_read_message_id uuid,
  last_read_at         timestamptz,
  muted_until          timestamptz,
  archived_at          timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id) WHERE left_at IS NULL;

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system message
  client_message_id text,                 -- client-generated idempotency key
  kind              text NOT NULL CHECK (kind IN ('text','emoji','gif','image','voice','system','date_invite','icebreaker')),
  body              text CHECK (char_length(body) <= 4000),
  gif_provider_id   text,
  reply_to_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  source_language   text,
  ai_assisted       boolean NOT NULL DEFAULT false,   -- user sent an AI suggestion (always explicit user action)
  moderation_status text NOT NULL DEFAULT 'clean' CHECK (moderation_status IN ('clean','pending','flagged','hidden','removed')),
  spam_score        real,
  created_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_conversation_cursor_idx ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX messages_moderation_idx ON messages (moderation_status, created_at) WHERE moderation_status IN ('pending','flagged');

ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_last_read_fk FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  ADD CONSTRAINT conversation_members_last_delivered_fk FOREIGN KEY (last_delivered_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE message_media (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('image','voice')),
  storage_key      text NOT NULL UNIQUE,
  mime_type        text NOT NULL,
  byte_size        bigint NOT NULL,
  width            int,
  height           int,
  duration_ms      int,
  waveform         smallint[],
  processing_status text NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('uploading','processing','ready','failed')),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected','needs_review')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL CHECK (char_length(emoji) <= 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Cached translations (BRD §11 optional translation). Viewer-requested only.
CREATE TABLE message_translations (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  locale     text NOT NULL,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, locale)
);

-- Voice/video calls (BRD §11 "where enabled"; Phase 2, flags 'voice_calls','video_calls').
CREATE TABLE calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiator_id    uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL CHECK (kind IN ('voice','video')),
  status          text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','missed','declined','failed')),
  provider        text NOT NULL,
  provider_room_id text,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calls_conversation_idx ON calls (conversation_id, created_at DESC);

-- Admin-managed icebreakers (BRD §11 "profile-aware icebreakers").
CREATE TABLE icebreaker_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('shared_interest','prompt','question_answer','location','generic')),
  trigger_ref text,           -- interest key / prompt key / question key
  is_active   boolean NOT NULL DEFAULT true
);
CREATE TABLE icebreaker_template_translations (
  template_id uuid NOT NULL REFERENCES icebreaker_templates(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  text        text NOT NULL,   -- may contain {{interest}}, {{name}} placeholders
  PRIMARY KEY (template_id, locale)
);
