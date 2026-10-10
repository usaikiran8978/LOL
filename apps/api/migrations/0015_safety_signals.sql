-- 0015 Richer safety signal domain (moderation categories are recorded as-is, not coerced).
ALTER TABLE safety_events DROP CONSTRAINT safety_events_signal_check;
ALTER TABLE safety_events ADD CONSTRAINT safety_events_signal_check CHECK (signal IN (
  'spam','scam','harassment','behavior_anomaly','fake_profile','duplicate_account','ai_generated_media','underage_risk',
  'off_platform_payment','sos','date_overdue','velocity','inappropriate_content','hate','violence','self_harm'));
