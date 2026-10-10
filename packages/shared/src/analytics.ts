/** Canonical analytics event names (TECH §19 + master prompt §29). Server and clients emit only these. */
export const ANALYTICS_EVENTS = [
  'signup_started', 'signup_completed', 'login_succeeded', 'login_failed', 'logout',
  'email_verified', 'phone_verified', 'password_reset_completed',
  'onboarding_step_completed', 'onboarding_completed', 'profile_completed', 'profile_updated', 'media_uploaded',
  'questionnaire_started', 'questionnaire_completed', 'question_answered',
  'profile_viewed', 'like_sent', 'pass_sent', 'super_like_sent', 'rewind_used', 'match_created', 'unmatched',
  'message_sent', 'conversation_started', 'call_started',
  'date_planned', 'date_completed', 'date_feedback_submitted', 'safety_session_started', 'sos_triggered',
  'event_viewed', 'event_registered', 'event_attended', 'event_feedback_submitted',
  'verification_started', 'verification_completed',
  'report_submitted', 'block_created',
  'subscription_started', 'subscription_cancelled', 'subscription_renewed', 'purchase_completed', 'paywall_viewed',
  'boost_activated',
  'ai_feature_used', 'recommendation_served', 'recommendation_accepted', 'recommendation_rejected',
  'notification_opened', 'experiment_exposure', 'account_deleted', 'data_export_requested',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Facts only the server can assert (verified by server-side state); clients may never emit these. */
export const SERVER_ONLY_ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  'signup_completed', 'login_succeeded', 'login_failed', 'match_created', 'subscription_started', 'subscription_cancelled',
  'subscription_renewed', 'purchase_completed', 'verification_completed', 'account_deleted', 'recommendation_served',
];
