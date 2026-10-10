-- Accounts created through a social provider that shares no verified email (Facebook, Apple private relay edge cases)
-- are identified by their auth_identities row instead of an email/phone.
ALTER TABLE users ADD COLUMN has_social_identity boolean NOT NULL DEFAULT false;
UPDATE users u SET has_social_identity = true WHERE EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id);
ALTER TABLE users DROP CONSTRAINT users_has_identifier;
ALTER TABLE users ADD CONSTRAINT users_has_identifier CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL OR has_social_identity OR status = 'deleted');
