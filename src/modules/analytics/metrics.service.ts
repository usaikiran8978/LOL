import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../../common/db/database';
import { JobScheduler } from '../../common/jobs/scheduler';

/** Every KPI the BRD (§21) asks for, computed per UTC day, globally and per country. */
export const KPI_DEFINITIONS: Record<string, { label: string; unit: 'count' | 'ratio' | 'minor_currency' | 'hours' | 'score' }> = {
  registrations: { label: 'Registrations', unit: 'count' },
  profile_completion_rate: { label: 'Profile completion (≥80%)', unit: 'ratio' },
  verification_rate: { label: 'Verified profiles', unit: 'ratio' },
  questionnaire_completion: { label: 'Questionnaire completion', unit: 'ratio' },
  dau: { label: 'Daily active users', unit: 'count' },
  mau: { label: 'Monthly active users', unit: 'count' },
  discovery_engagement: { label: 'Recommendations served', unit: 'count' },
  likes: { label: 'Likes sent', unit: 'count' },
  like_pass_ratio: { label: 'Like / pass ratio', unit: 'ratio' },
  matches: { label: 'Matches', unit: 'count' },
  match_rate: { label: 'Match rate (matches per like)', unit: 'ratio' },
  conversation_start_rate: { label: 'Conversation start rate', unit: 'ratio' },
  messages_per_conversation: { label: 'Messages per active conversation', unit: 'score' },
  reply_rate: { label: 'Reply rate', unit: 'ratio' },
  dates_planned: { label: 'Dates planned', unit: 'count' },
  date_conversion: { label: 'Date conversion (dates per match, 30d)', unit: 'ratio' },
  post_date_satisfaction: { label: 'Post-date satisfaction (1–5)', unit: 'score' },
  retention_d1: { label: 'D1 retention', unit: 'ratio' },
  retention_d7: { label: 'D7 retention', unit: 'ratio' },
  retention_d30: { label: 'D30 retention', unit: 'ratio' },
  churn: { label: 'Subscription churn (cancellations / active)', unit: 'ratio' },
  premium_users: { label: 'Premium users', unit: 'count' },
  premium_conversion: { label: 'Premium conversion', unit: 'ratio' },
  revenue: { label: 'Net revenue', unit: 'minor_currency' },
  arpu: { label: 'ARPU (30d)', unit: 'minor_currency' },
  arppu: { label: 'ARPPU (30d)', unit: 'minor_currency' },
  reports: { label: 'Reports', unit: 'count' },
  report_rate: { label: 'Reports per 1,000 DAU', unit: 'score' },
  moderation_sla: { label: 'Cases resolved within SLA', unit: 'ratio' },
  moderation_resolution_hours: { label: 'Median resolution time', unit: 'hours' },
  safety_incidents: { label: 'Safety incidents (SOS / overdue)', unit: 'count' },
  event_attendance: { label: 'Event attendance (checked-in / registered)', unit: 'ratio' },
  ai_requests: { label: 'AI requests', unit: 'count' },
  ai_recommendation_acceptance: { label: 'AI recommendation acceptance', unit: 'ratio' },
};

/**
 * Daily KPI aggregation (BRD §21) into analytics_daily_metrics, plus analytics_events partition maintenance.
 * Every metric is a single set-based SQL statement over source-of-truth tables (not client events), so dashboards stay
 * correct even if a client drops analytics.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.jobs.register('analytics.daily_metrics', 3600, async () => {
      // Recompute today and yesterday (late events) every hour.
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await this.compute(yesterday);
      await this.compute(today);
    });
    this.jobs.register('analytics.partitions', 24 * 3600, () => this.ensurePartitions());
  }

  /** Monthly partitions for the next 3 months; existing rows stay in the default partition until archived. */
  async ensurePartitions(): Promise<void> {
    const d = new Date();
    for (let i = 0; i < 3; i++) {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i + 1, 1));
      const name = `analytics_events_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      const exists = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_class WHERE relname = ${name}`.execute(this.db);
      if (exists.rows[0]!.n > 0) continue;
      // The default partition must not hold rows for the new range; move any into place first.
      await this.db.transaction().execute(async (trx) => {
        // Constraints + indexes must match the parent to attach; identity stays on the parent (inserts route through it).
        await sql.raw(`CREATE TABLE ${name} (LIKE analytics_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`).execute(trx);
        await sql.raw(`INSERT INTO ${name} SELECT * FROM analytics_events_default WHERE occurred_at >= '${start.toISOString()}' AND occurred_at < '${end.toISOString()}'`).execute(trx);
        await sql.raw(`DELETE FROM analytics_events_default WHERE occurred_at >= '${start.toISOString()}' AND occurred_at < '${end.toISOString()}'`).execute(trx);
        await sql.raw(`ALTER TABLE analytics_events ATTACH PARTITION ${name} FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`).execute(trx);
      });
      this.logger.log(`created partition ${name}`);
    }
  }

  async compute(day: string): Promise<void> {
    const from = `${day}T00:00:00Z`;
    const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
    const d30 = new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString();
    // Each query returns rows of (dimension, value); dimension 'all' plus 'country:XX'.
    const q = (body: string) => sql.raw(body.replaceAll(':from', `'${from}'::timestamptz`).replaceAll(':to', `'${to}'::timestamptz`).replaceAll(':d30', `'${d30}'::timestamptz`));
    const byCountry = (inner: string, valueExpr: string, userCol = 'u') => `
      SELECT 'all' AS dimension, ${valueExpr} AS value FROM (${inner}) x
      UNION ALL
      SELECT 'country:' || ${userCol}_country AS dimension, ${valueExpr} AS value FROM (${inner}) x WHERE ${userCol}_country IS NOT NULL GROUP BY ${userCol}_country`;

    const metrics: Record<string, string> = {
      registrations: byCountry(`SELECT u.country_code AS u_country FROM users u WHERE u.created_at >= :from AND u.created_at < :to`, 'count(*)'),
      profile_completion_rate: byCountry(`SELECT u.country_code AS u_country, (p.completeness_score >= 80)::int AS ok FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.status = 'active' AND u.created_at < :to`, 'coalesce(avg(ok), 0)'),
      verification_rate: byCountry(`SELECT u.country_code AS u_country, (p.verification_level IN ('selfie','identity'))::int AS ok FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.status = 'active' AND u.created_at < :to`, 'coalesce(avg(ok), 0)'),
      questionnaire_completion: byCountry(`SELECT u.country_code AS u_country, (EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = u.id AND e.name = 'questionnaire_completed' AND e.occurred_at < :to))::int AS ok FROM users u WHERE u.status = 'active' AND u.created_at < :to`, 'coalesce(avg(ok), 0)'),
      dau: byCountry(`SELECT u.country_code AS u_country FROM users u WHERE u.last_active_at >= :from AND u.last_active_at < :to`, 'count(*)'),
      mau: byCountry(`SELECT u.country_code AS u_country FROM users u WHERE u.last_active_at >= :d30 AND u.last_active_at < :to`, 'count(*)'),
      discovery_engagement: byCountry(`SELECT u.country_code AS u_country FROM match_candidates mc JOIN users u ON u.id = mc.user_id WHERE mc.served_at >= :from AND mc.served_at < :to`, 'count(*)'),
      likes: byCountry(`SELECT u.country_code AS u_country FROM swipe_actions s JOIN users u ON u.id = s.actor_id WHERE s.action IN ('like','super_like') AND s.created_at >= :from AND s.created_at < :to`, 'count(*)'),
      like_pass_ratio: byCountry(`SELECT u.country_code AS u_country, (s.action <> 'pass')::int AS liked FROM swipe_actions s JOIN users u ON u.id = s.actor_id WHERE s.created_at >= :from AND s.created_at < :to`, 'coalesce(sum(liked)::numeric / nullif(count(*) - sum(liked), 0), 0)'),
      matches: byCountry(`SELECT u.country_code AS u_country FROM matches m JOIN users u ON u.id = m.user_low_id WHERE m.created_at >= :from AND m.created_at < :to`, 'count(*)'),
      match_rate: `SELECT 'all' AS dimension, coalesce((SELECT count(*) FROM matches WHERE created_at >= :from AND created_at < :to)::numeric / nullif((SELECT count(*) FROM swipe_actions WHERE action IN ('like','super_like') AND created_at >= :from AND created_at < :to), 0), 0) AS value`,
      conversation_start_rate: `SELECT 'all' AS dimension, coalesce(avg((j.conversation_at IS NOT NULL)::int), 0) AS value FROM matches m JOIN relationship_journeys j ON j.match_id = m.id WHERE m.created_at >= :d30 AND m.created_at < :to`,
      messages_per_conversation: `SELECT 'all' AS dimension, coalesce(avg(n), 0) AS value FROM (SELECT count(*) AS n FROM messages WHERE created_at >= :from AND created_at < :to AND sender_id IS NOT NULL GROUP BY conversation_id) x`,
      reply_rate: `SELECT 'all' AS dimension, coalesce(avg(reply_rate_30d), 0) AS value FROM user_behavior_stats WHERE reply_rate_30d IS NOT NULL`,
      dates_planned: `SELECT 'all' AS dimension, count(*) AS value FROM date_plans WHERE created_at >= :from AND created_at < :to`,
      date_conversion: `SELECT 'all' AS dimension, coalesce((SELECT count(DISTINCT match_id) FROM date_plans WHERE status = 'completed' AND starts_at >= :d30 AND starts_at < :to)::numeric / nullif((SELECT count(*) FROM matches WHERE created_at >= :d30 AND created_at < :to), 0), 0) AS value`,
      post_date_satisfaction: `SELECT 'all' AS dimension, coalesce(avg(overall), 0) AS value FROM date_feedback WHERE created_at >= :d30 AND created_at < :to AND overall IS NOT NULL`,
      retention_d1: this.retention(1),
      retention_d7: this.retention(7),
      retention_d30: this.retention(30),
      churn: `SELECT 'all' AS dimension, coalesce((SELECT count(*) FROM subscriptions WHERE canceled_at >= :from AND canceled_at < :to)::numeric / nullif((SELECT count(*) FROM subscriptions WHERE status IN ('active','trialing','in_grace','past_due')), 0), 0) AS value`,
      premium_users: `SELECT 'all' AS dimension, count(DISTINCT user_id) AS value FROM subscriptions WHERE status IN ('active','trialing','in_grace','past_due')`,
      premium_conversion: `SELECT 'all' AS dimension, coalesce((SELECT count(DISTINCT user_id) FROM subscriptions WHERE status IN ('active','trialing','in_grace','past_due'))::numeric / nullif((SELECT count(*) FROM users WHERE status = 'active'), 0), 0) AS value`,
      // Net revenue in minor units of each currency is not additive; report per currency as dimension.
      revenue: `SELECT 'currency:' || currency AS dimension, sum(amount_minor - refunded_minor) AS value FROM payments WHERE status IN ('succeeded','partially_refunded','refunded') AND created_at >= :from AND created_at < :to GROUP BY currency`,
      arpu: `SELECT 'currency:' || currency AS dimension, sum(amount_minor - refunded_minor)::numeric / nullif((SELECT count(*) FROM users WHERE last_active_at >= :d30), 0) AS value FROM payments WHERE status IN ('succeeded','partially_refunded') AND created_at >= :d30 AND created_at < :to GROUP BY currency`,
      arppu: `SELECT 'currency:' || currency AS dimension, sum(amount_minor - refunded_minor)::numeric / nullif(count(DISTINCT user_id), 0) AS value FROM payments WHERE status IN ('succeeded','partially_refunded') AND created_at >= :d30 AND created_at < :to GROUP BY currency`,
      reports: `SELECT 'all' AS dimension, count(*) AS value FROM reports WHERE created_at >= :from AND created_at < :to`,
      report_rate: `SELECT 'all' AS dimension, coalesce((SELECT count(*) FROM reports WHERE created_at >= :from AND created_at < :to) * 1000.0 / nullif((SELECT count(*) FROM users WHERE last_active_at >= :from AND last_active_at < :to), 0), 0) AS value`,
      moderation_sla: `SELECT 'all' AS dimension, coalesce(avg((resolved_at <= sla_due_at)::int), 0) AS value FROM moderation_cases WHERE resolved_at >= :from AND resolved_at < :to`,
      moderation_resolution_hours: `SELECT 'all' AS dimension, coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - opened_at) / 3600), 0) AS value FROM moderation_cases WHERE resolved_at >= :from AND resolved_at < :to`,
      safety_incidents: `SELECT 'all' AS dimension, count(*) AS value FROM safety_events WHERE signal IN ('sos','date_overdue') AND created_at >= :from AND created_at < :to`,
      event_attendance: `SELECT 'all' AS dimension, coalesce(avg((a.status = 'checked_in')::int), 0) AS value FROM event_attendees a JOIN events e ON e.id = a.event_id WHERE e.starts_at >= :from AND e.starts_at < :to AND a.status IN ('checked_in','registered','no_show')`,
      ai_requests: `SELECT 'all' AS dimension, count(*) AS value FROM ai_requests WHERE created_at >= :from AND created_at < :to`,
      ai_recommendation_acceptance: `SELECT 'all' AS dimension, coalesce(avg((outcome = 'accepted')::int), 0) AS value FROM recommendation_feedback WHERE created_at >= :from AND created_at < :to`,
    };

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('analytics_daily_metrics').where('metric_date', '=', day).execute();
      for (const [metric, body] of Object.entries(metrics)) {
        const res = await q(body).execute(trx);
        const rows = (res.rows as Array<{ dimension: string; value: string | number | null }>).filter((r) => r.value !== null);
        if (rows.length) {
          await trx.insertInto('analytics_daily_metrics').values(rows.map((r) => ({ metric_date: day, metric, dimension: r.dimension, value: String(r.value) })))
            .onConflict((oc) => oc.columns(['metric_date', 'metric', 'dimension']).doUpdateSet({ value: sql`excluded.value`, computed_at: new Date() })).execute();
        }
      }
    });
  }

  /** Share of users registered N days before `day` who were active on or after day N. */
  private retention(n: number): string {
    return `SELECT 'all' AS dimension, coalesce(avg((u.last_active_at >= u.created_at + interval '${n} days')::int), 0) AS value
            FROM users u WHERE u.created_at >= :from - interval '${n} days' AND u.created_at < :to - interval '${n} days'`;
  }

  async dashboard(days: number) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.db.selectFrom('analytics_daily_metrics').select(['metric_date', 'metric', 'dimension', 'value']).where('metric_date', '>=', since).where('dimension', 'in', ['all', 'currency:USD', 'currency:EUR', 'currency:INR', 'currency:GBP']).orderBy('metric_date').execute();
    const live = await sql<{ total_users: number; active_users: number; premium: number; open_cases: number; breached: number }>`
      SELECT (SELECT count(*)::int FROM users WHERE status <> 'deleted') AS total_users,
             (SELECT count(*)::int FROM users WHERE last_active_at > now() - interval '1 day') AS active_users,
             (SELECT count(DISTINCT user_id)::int FROM subscriptions WHERE status IN ('active','trialing','in_grace','past_due')) AS premium,
             (SELECT count(*)::int FROM moderation_cases WHERE status IN ('open','in_review','escalated')) AS open_cases,
             (SELECT count(*)::int FROM moderation_cases WHERE status IN ('open','in_review','escalated') AND sla_due_at < now()) AS breached`.execute(this.db);
    const series: Record<string, Array<{ date: string; dimension: string; value: number }>> = {};
    for (const r of rows) (series[r.metric] ??= []).push({ date: String(r.metric_date), dimension: r.dimension, value: Number(r.value) });
    return { definitions: KPI_DEFINITIONS, live: live.rows[0], series };
  }

  async series(metric: string, from: string, to: string, dimension: string) {
    return this.db.selectFrom('analytics_daily_metrics').select(['metric_date', 'value']).where('metric', '=', metric).where('dimension', '=', dimension)
      .where('metric_date', '>=', from).where('metric_date', '<=', to).orderBy('metric_date').execute();
  }
}
