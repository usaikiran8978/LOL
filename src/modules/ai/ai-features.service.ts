import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DATABASE, type Database } from '../../common/db/database';
import { activeMatch, blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';
import { CatalogService } from '../catalog/catalog.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { AiGatewayService } from './ai-gateway.service';

const FLAG: Record<string, string> = {
  profile_coach: 'ai.profile_coach', onboarding_assistant: 'ai.profile_coach', match_explanation: 'ai.profile_coach',
  conversation_starter: 'ai.conversation_starters', conversation_coach: 'ai.conversation_starters', scam_risk: 'ai.conversation_starters',
  translation: 'ai.translation', post_date_reflection: 'ai.profile_coach', relationship_insights: 'ai.profile_coach',
};

/**
 * AI features (BRD §12, TECH §9). Inputs are assembled server-side from data the requester may already see, with
 * minimization (no contact details, exact location, birth date, sensitive attributes unless consented). Outputs are
 * suggestions returned to the user — nothing is ever sent on the user's behalf.
 */
@Injectable()
export class AiFeaturesService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly gateway: AiGatewayService,
    private readonly catalog: CatalogService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    // Second-line safety classification of chat messages that tripped keyword rules (cheap first, model second).
    this.outbox.on('message.created', async (p) => {
      const m = await this.db.selectFrom('messages').select(['id', 'body', 'sender_id', 'moderation_status', 'spam_score']).where('id', '=', String(p.messageId)).executeTakeFirst();
      if (!m?.body || !m.sender_id || m.moderation_status !== 'flagged') return;
      const cfg = await this.db.selectFrom('ai_feature_configs').select('is_enabled').where('feature_key', '=', 'safety_classifier').executeTakeFirst();
      if (!cfg?.is_enabled) return;
      const r = await this.gateway.run<{ scam: number; harassment: number; explicit: number; selfHarm: number }>('safety_classifier', { message: m.body }, { userId: null, skipLimits: true }).catch(() => null);
      if (!r) return;
      const worst = Object.entries(r.output).sort((a, b) => b[1] - a[1])[0]!;
      const signal = { scam: 'scam', harassment: 'harassment', explicit: 'inappropriate_content', selfHarm: 'self_harm' }[worst[0]] ?? 'harassment';
      if (worst[1] >= 0.5) await this.db.insertInto('safety_events').values({ user_id: m.sender_id, signal, source: 'ai.safety_classifier', score: worst[1], ref_type: 'message', ref_id: m.id, details: JSON.stringify(r.output) }).execute();
    });
  }

  private async gate(userId: string, feature: string) {
    const flag = FLAG[feature];
    if (flag) await this.flags.assertEnabled(flag, await this.facts.load(userId));
  }

  private async labels(userId: string, locale: string) {
    const [interests, attrs, profile] = await Promise.all([
      this.db.selectFrom('user_interests').select('interest_id').where('user_id', '=', userId).execute(),
      this.db.selectFrom('user_profile_attributes as a').innerJoin('taxonomy_terms as t', 't.id', 'a.term_id').select(['a.kind', 'a.term_id', 't.is_sensitive']).where('a.user_id', '=', userId).execute(),
      this.db.selectFrom('user_profiles').select(['dating_intent_id', 'relationship_goal_id']).where('user_id', '=', userId).executeTakeFirst(),
    ]);
    const ps = await this.db.selectFrom('user_privacy_settings').select('allow_ai_profile_analysis').where('user_id', '=', userId).executeTakeFirst();
    const sensitiveOk = !!ps?.allow_ai_profile_analysis && (await this.consent(userId, 'ai_sensitive_data'));
    const interestLabels = new Map((await this.catalog.interests(locale)).flatMap((c) => c.interests).map((i) => [i.id, i.label]));
    const kinds = [...new Set(attrs.map((a) => a.kind)), 'dating_intent', 'relationship_goal'];
    const terms = new Map((await this.catalog.terms(kinds, locale)).map((t) => [t.id, t.label]));
    return {
      // Sorted so prompts are deterministic (reproducible outputs, cache hits, stable tests).
      interests: interests.map((i) => interestLabels.get(i.interest_id)).filter((x): x is string => !!x).sort((x, y) => x.localeCompare(y, locale)).join(', '),
      // Sensitive attributes (religion, politics…) only with explicit consent (DEC-007).
      attributes: attrs.filter((a) => sensitiveOk || !a.is_sensitive).map((a) => `${a.kind}: ${terms.get(a.term_id) ?? ''}`).join('; '),
      intent: terms.get(profile?.dating_intent_id ?? '') ?? '',
      goal: terms.get(profile?.relationship_goal_id ?? '') ?? '',
    };
  }

  private async consent(userId: string, type: string): Promise<boolean> {
    const c = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', type).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    return !!c?.granted;
  }

  /** The requester may only reference someone they matched with or were recommended. */
  private async assertRelationship(userId: string, otherId: string) {
    if (await blockedEitherWay(this.db, userId, otherId)) throw new AppError('NOT_FOUND');
    if (await activeMatch(this.db, userId, otherId)) return;
    const rec = await this.db.selectFrom('match_candidates').select('id').where('user_id', '=', userId).where('candidate_id', '=', otherId).executeTakeFirst();
    if (!rec) throw new AppError('NOT_FOUND');
  }

  // ------------------------------------------------------------------------------------ features

  async profileCoach(userId: string, focus: string, locale: string) {
    await this.gate(userId, 'profile_coach');
    const p = await this.db.selectFrom('user_profiles').select(['bio', 'completeness_score', 'profession']).where('user_id', '=', userId).executeTakeFirst();
    if (!p) throw new AppError('PROFILE_INCOMPLETE');
    const [prompts, photos, l] = await Promise.all([
      this.db.selectFrom('profile_prompts as pp').innerJoin('prompt_catalog_translations as t', (j) => j.onRef('t.prompt_id', '=', 'pp.prompt_id').on('t.locale', '=', 'en')).select(['t.text', 'pp.answer']).where('pp.user_id', '=', userId).execute(),
      this.db.selectFrom('profile_media').select('id').where('user_id', '=', userId).where('kind', '=', 'photo').where('deleted_at', 'is', null).execute(),
      this.labels(userId, locale),
    ]);
    const r = await this.gateway.run<{ score: number; suggestions: Array<{ area: string; tip: string }>; bioSuggestion?: string }>('profile_coach', {
      bio: p.bio ?? '', prompts: prompts.map((x) => `${x.text} — ${x.answer}`).join('\n'), profession: p.profession ?? '',
      interests: l.interests, intent: l.intent, photoCount: String(photos.length), completeness: String(p.completeness_score), focus, locale,
    }, { userId, trusted: ['interests', 'intent', 'photoCount', 'completeness', 'focus', 'locale'] });
    return r.output;
  }

  async onboardingAssist(userId: string, tone: string, locale: string) {
    await this.gate(userId, 'onboarding_assistant');
    const l = await this.labels(userId, locale);
    const p = await this.db.selectFrom('user_profiles').select(['bio', 'profession']).where('user_id', '=', userId).executeTakeFirst();
    const prompts = (await this.catalog.prompts(locale)).slice(0, 10).map((x) => `${x.key}: ${x.text}`).join('\n');
    const r = await this.gateway.run<{ bioDrafts: string[]; promptIdeas: Array<{ promptKey: string; answerDraft: string }> }>('onboarding_assistant', {
      interests: l.interests, attributes: l.attributes, intent: l.intent, goal: l.goal, profession: p?.profession ?? '', currentBio: p?.bio ?? '', tone, availablePrompts: prompts, locale,
    }, { userId, trusted: ['interests', 'attributes', 'intent', 'goal', 'tone', 'availablePrompts', 'locale'] });
    return r.output;
  }

  async matchExplanation(userId: string, otherId: string, locale: string) {
    await this.gate(userId, 'match_explanation');
    await this.assertRelationship(userId, otherId);
    const rec = await this.db.selectFrom('match_candidates').select(['compatibility', 'top_factors', 'differences', 'factor_scores']).where('user_id', '=', userId).where('candidate_id', '=', otherId).orderBy('computed_at', 'desc').limit(1).executeTakeFirst();
    const [mine, theirs] = await Promise.all([this.labels(userId, locale), this.labels(otherId, locale)]);
    const shared = mine.interests.split(', ').filter((i) => i && theirs.interests.split(', ').includes(i)).join(', ');
    // Grounded strictly on stored engine factors — the model explains, it does not re-score.
    const r = await this.gateway.run<{ summary: string; highlights: string[]; conversationTopics: string[] }>('match_explanation', {
      compatibility: String(rec?.compatibility ?? ''), factors: JSON.stringify(rec?.factor_scores ?? {}), topFactors: JSON.stringify(rec?.top_factors ?? []), differences: JSON.stringify(rec?.differences ?? []),
      sharedInterests: shared, theirIntent: theirs.intent, myIntent: mine.intent, locale,
    }, { userId, trusted: ['compatibility', 'factors', 'topFactors', 'differences', 'sharedInterests', 'theirIntent', 'myIntent', 'locale'] });
    return r.output;
  }

  async conversationStarters(userId: string, input: { conversationId?: string; userId?: string }, locale: string) {
    await this.gate(userId, 'conversation_starter');
    let otherId = input.userId;
    if (input.conversationId) {
      const other = await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', input.conversationId).where('user_id', '<>', userId)
        .where((eb) => eb.exists(eb.selectFrom('conversation_members as me').select('me.user_id').where('me.conversation_id', '=', input.conversationId!).where('me.user_id', '=', userId))).executeTakeFirst();
      if (!other) throw new AppError('NOT_FOUND');
      otherId = other.user_id;
    }
    await this.assertRelationship(userId, otherId!);
    const [prompts, mine, theirs] = await Promise.all([
      this.db.selectFrom('profile_prompts as pp').innerJoin('prompt_catalog_translations as t', (j) => j.onRef('t.prompt_id', '=', 'pp.prompt_id').on('t.locale', '=', 'en')).select(['t.text', 'pp.answer'])
        .where('pp.user_id', '=', otherId!).where('pp.moderation_status', '=', 'approved').execute(),
      this.labels(userId, locale), this.labels(otherId!, locale),
    ]);
    const shared = mine.interests.split(', ').filter((i) => i && theirs.interests.split(', ').includes(i)).join(', ');
    const r = await this.gateway.run<{ starters: string[] }>('conversation_starter', {
      theirPrompts: prompts.map((x) => `${x.text} — ${x.answer}`).join('\n'), sharedInterests: shared, theirInterests: theirs.interests, locale,
    }, { userId, trusted: ['sharedInterests', 'theirInterests', 'locale'] });
    return { starters: r.output.starters, sendRequiresUserAction: true };
  }

  private async conversationTranscript(userId: string, conversationId: string, limit: number, onlyThem = false) {
    const member = await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', conversationId).where('user_id', '=', userId).executeTakeFirst();
    if (!member) throw new AppError('NOT_FOUND');
    let qb = this.db.selectFrom('messages').select(['sender_id', 'body', 'kind']).where('conversation_id', '=', conversationId).where('deleted_at', 'is', null)
      .where('moderation_status', 'in', ['clean', 'flagged']).where('kind', 'in', ['text', 'emoji', 'icebreaker']).orderBy('created_at', 'desc').limit(limit);
    if (onlyThem) qb = qb.where('sender_id', '<>', userId);
    const rows = (await qb.execute()).reverse();
    // Names are never sent: "You" / "Them".
    return rows.map((r) => `${r.sender_id === userId ? 'You' : 'Them'}: ${r.body ?? ''}`).join('\n');
  }

  async conversationCoach(userId: string, conversationId: string, goal: string, locale: string) {
    await this.gate(userId, 'conversation_coach');
    const ps = await this.db.selectFrom('user_privacy_settings').select('allow_ai_message_analysis').where('user_id', '=', userId).executeTakeFirst();
    if (!ps?.allow_ai_message_analysis) throw new AppError('CONSENT_REQUIRED', 'Enable AI message analysis in privacy settings', { kind: 'setting', setting: 'allowAiMessageAnalysis' });
    const transcript = await this.conversationTranscript(userId, conversationId, 20);
    if (!transcript) throw new AppError('VALIDATION_FAILED', 'Nothing to analyse yet');
    const r = await this.gateway.run<{ assessment: string; suggestions: string[]; replyIdeas: string[] }>('conversation_coach', { transcript, goal, locale }, { userId, trusted: ['goal', 'locale'] });
    return { ...r.output, sendRequiresUserAction: true };
  }

  async scamCheck(userId: string, conversationId: string) {
    await this.gate(userId, 'scam_risk');
    const transcript = await this.conversationTranscript(userId, conversationId, 30, true);
    if (!transcript) return { riskLevel: 'low', reasons: [], advice: [] };
    const r = await this.gateway.run<{ riskLevel: 'low' | 'medium' | 'high'; reasons: string[]; advice: string[] }>('scam_risk', { transcript }, { userId });
    if (r.output.riskLevel === 'high') {
      const other = await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', conversationId).where('user_id', '<>', userId).executeTakeFirst();
      if (other) await this.db.insertInto('safety_events').values({ user_id: other.user_id, signal: 'scam', source: 'ai.scam_risk', score: 0.7, ref_type: 'conversation', ref_id: conversationId, details: JSON.stringify({ reasons: r.output.reasons }) }).execute();
    }
    return r.output;
  }

  async translate(userId: string, messageId: string, targetLocale: string) {
    await this.gate(userId, 'translation');
    const m = await this.db.selectFrom('messages as m').innerJoin('conversation_members as cm', (j) => j.onRef('cm.conversation_id', '=', 'm.conversation_id').on('cm.user_id', '=', userId))
      .select(['m.id', 'm.body', 'm.moderation_status']).where('m.id', '=', messageId).where('m.deleted_at', 'is', null).executeTakeFirst();
    if (!m?.body || !['clean', 'flagged'].includes(m.moderation_status)) throw new AppError('NOT_FOUND');
    const ps = await this.db.selectFrom('user_privacy_settings').select('allow_translation').where('user_id', '=', userId).executeTakeFirst();
    if (ps?.allow_translation === false) throw new AppError('FEATURE_DISABLED', 'Translation is turned off in your settings', { setting: 'allowTranslation' });
    // Cache hits are free (no usage counted) but still respect consent and plan gating.
    await this.gateway.assertAccess('translation', userId);
    const cached = await this.db.selectFrom('message_translations').select('text').where('message_id', '=', messageId).where('locale', '=', targetLocale).executeTakeFirst();
    if (cached) return { translation: cached.text, cached: true };
    const r = await this.gateway.run<{ translation: string; detectedLanguage?: string }>('translation', { text: m.body, targetLocale }, { userId, trusted: ['targetLocale'] });
    await this.db.insertInto('message_translations').values({ message_id: messageId, locale: targetLocale, text: r.output.translation }).onConflict((oc) => oc.doNothing()).execute();
    return { translation: r.output.translation, detectedLanguage: r.output.detectedLanguage ?? null, cached: false };
  }

  async reflection(userId: string, matchId: string, locale: string) {
    await this.gate(userId, 'post_date_reflection');
    const m = await this.db.selectFrom('matches').select(['user_low_id', 'user_high_id']).where('id', '=', matchId).executeTakeFirst();
    if (!m || ![m.user_low_id, m.user_high_id].includes(userId)) throw new AppError('NOT_FOUND');
    // Only the requester's own private feedback is used — never the other person's.
    const fb = await this.db.selectFrom('date_feedback').select(['date_happened', 'overall', 'felt_safe', 'want_second_date', 'tags', 'private_note']).where('match_id', '=', matchId).where('author_id', '=', userId).orderBy('created_at').execute();
    const journey = await this.db.selectFrom('relationship_journeys').select('stage').where('match_id', '=', matchId).executeTakeFirst();
    if (!fb.length) throw new AppError('VALIDATION_FAILED', 'Add feedback about your date first');
    const r = await this.gateway.run<{ reflection: string; nextSteps: string[] }>('post_date_reflection', {
      feedback: fb.map((f) => `happened=${f.date_happened}; overall=${f.overall ?? ''}; feltSafe=${f.felt_safe ?? ''}; secondDate=${f.want_second_date ?? ''}`).join('\n'),
      tags: fb.flatMap((f) => f.tags).join(', '),
      notes: fb.map((f) => f.private_note ?? '').filter(Boolean).join('\n'), stage: journey?.stage ?? '', locale,
    }, { userId, trusted: ['feedback', 'stage', 'locale'] });
    return r.output;
  }

  async relationshipInsights(userId: string, locale: string) {
    await this.gate(userId, 'relationship_insights');
    const [stats, stages, tags] = await Promise.all([
      this.db.selectFrom('user_behavior_stats').selectAll().where('user_id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('relationship_journeys as j').innerJoin('matches as m', 'm.id', 'j.match_id').select(['j.stage']).where((eb) => eb.or([eb('m.user_low_id', '=', userId), eb('m.user_high_id', '=', userId)])).execute(),
      this.db.selectFrom('date_feedback').select(['tags', 'want_second_date']).where('author_id', '=', userId).execute(),
    ]);
    const stageCounts = stages.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.stage]: (acc[s.stage] ?? 0) + 1 }), {});
    const r = await this.gateway.run<{ insights: Array<{ title: string; detail: string }> }>('relationship_insights', {
      stats: JSON.stringify({ matches: stats?.matches_30d ?? 0, conversations: stats?.conversations_started_30d ?? 0, replyRate: stats?.reply_rate_30d ?? null, datesCompleted: stats?.dates_completed_90d ?? 0 }),
      journey: JSON.stringify(stageCounts), feedbackTags: tags.flatMap((t) => t.tags).join(', '), locale,
    }, { userId, trusted: ['stats', 'journey', 'locale'] }); // feedbackTags are user-entered → treated as user content
    return r.output;
  }
}
