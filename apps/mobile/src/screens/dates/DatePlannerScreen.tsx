import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { AI_FLAGS } from '../../api/ai';
import { datesApi, type AiDateIdeas, type DatePlan } from '../../api/experiences';
import { useSession } from '../../auth/SessionProvider';
import { Badge, Button, DateField, FormError, Notice, Screen, Text, TextField } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { AiStatus, useAi } from '../../features/ai/useAi';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Local date + time → ISO instant (the API stores UTC; the device's zone is the user's intent). */
export function toStartsAt(date: string, time: string): string | null {
  if (!date || !TIME.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const at = new Date(y!, m! - 1, d!, hh!, mm!);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function PlanCard({ plan, me, onChanged, onSafety, onReport }: { plan: DatePlan; me: string | null; onChanged: () => void; onSafety: () => void; onReport: () => void }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const respond = useAction(async (r: 'accepted' | 'declined') => {
    await datesApi.respond(plan.id, r);
    onChanged();
  });
  const cancel = useAction(async () => {
    await datesApi.cancel(plan.id);
    onChanged();
  });
  const mine = plan.proposedBy === me;
  const awaiting = !mine && (plan.status === 'proposed' || plan.status === 'rescheduled') && plan.myResponse === 'pending';
  const live = !['cancelled', 'completed', 'declined'].includes(plan.status);
  return (
    <View testID={`plan-${plan.id}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading" style={{ flex: 1 }}>{plan.title}</Text>
        <Badge tone={plan.status === 'accepted' ? 'success' : plan.status === 'declined' || plan.status === 'cancelled' ? 'danger' : 'neutral'} label={t(`dates.status.${plan.status}`)} />
      </View>
      <Text color="textMuted">{[formatDateTime(plan.startsAt), plan.venue.name].filter(Boolean).join(' · ')}</Text>
      {plan.notes ? <Text style={{ marginTop: spacing.xs }}>{plan.notes}</Text> : null}
      <FormError error={respond.error ?? cancel.error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        {awaiting ? <Button label={t('dates.accept')} onPress={() => void respond.run('accepted')} loading={respond.pending} testID={`plan-accept-${plan.id}`} /> : null}
        {awaiting ? <Button variant="secondary" label={t('dates.decline')} onPress={() => void respond.run('declined')} disabled={respond.pending} testID={`plan-decline-${plan.id}`} /> : null}
        {live ? <Button variant="secondary" label={t('dateSafety.title')} onPress={onSafety} testID={`plan-safety-${plan.id}`} /> : null}
        {live ? <Button variant="ghost" label={t('dates.cancel')} onPress={() => void cancel.run()} loading={cancel.pending} testID={`plan-cancel-${plan.id}`} /> : null}
        <Button variant="ghost" label={t('safety.reportDate')} onPress={onReport} />
      </View>
    </View>
  );
}

/** Date planner for one match: existing plans, idea suggestions (catalog + optional AI) and proposing a date. */
export default function DatePlannerScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { matchId, name } = useLocalSearchParams<{ matchId: string; name?: string }>();
  const plans = useResource(() => datesApi.forMatch(matchId!), [matchId]);
  const ideas = useResource(() => datesApi.ideas(matchId!), [matchId]);
  const aiOn = useFlag(AI_FLAGS.datePlanner);
  const [aiIdeas, setAiIdeas] = useState<AiDateIdeas['ideas']>([]);
  const ai = useAi('date_planner', async () => {
    const r = await datesApi.aiIdeas(matchId!);
    setAiIdeas(r.ideas);
    return r;
  });
  const [title, setTitle] = useState('');
  const [activityType, setActivityType] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [notes, setNotes] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const startsAt = toStartsAt(date, time);
  const inPast = !!startsAt && new Date(startsAt) <= new Date();

  const applyIdea = (i: { title: string; activityType: string }, fromAi: boolean) => {
    setTitle(i.title);
    setActivityType(i.activityType);
    setAiGenerated(fromAi);
  };

  const create = useAction(async () => {
    if (!startsAt) return;
    const plan = await datesApi.create({ matchId: matchId!, title: title.trim(), activityType: activityType.trim() || 'other', venueName: venue.trim() || undefined, notes: notes.trim() || undefined, startsAt, aiGenerated });
    analytics.track('date_planned', { aiGenerated });
    plans.setData([plan, ...(plans.data ?? [])]);
    setTitle('');
    setVenue('');
    setNotes('');
    setAiGenerated(false);
  });

  const who = name || t('discover.someone');
  return (
    <Screen title={t('dates.title', { name: who })} status={plans.data ? 'ready' : plans.status} error={plans.error} onRetry={plans.reload} testID="dates-screen">
      {plans.data?.length ? (
        plans.data.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            me={user?.id ?? null}
            onChanged={plans.reload}
            onSafety={() => router.push({ pathname: '/safety/date', params: { datePlanId: p.id } })}
            onReport={() => router.push({ pathname: '/safety/report', params: { targetType: 'date', targetId: p.id, name: who } })}
          />
        ))
      ) : (
        <Notice title={t('dates.none')} testID="dates-empty" />
      )}

      <Text variant="heading" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        {t('dates.ideas')}
      </Text>
      {ideas.data?.length ? (
        ideas.data.slice(0, 5).map((i) => (
          <Button key={i.key} variant="ghost" label={t('dates.ideaLabel', { title: i.title, minutes: formatNumber(i.durationMin) })} onPress={() => applyIdea(i, false)} testID={`idea-${i.key}`} />
        ))
      ) : ideas.status === 'error' ? (
        <FormError error={ideas.error} />
      ) : null}
      {aiOn ? (
        <View>
          <AiStatus ai={ai} surface="date_planner" testID="date-ai" />
          <Button variant="secondary" label={t('dates.aiIdeas')} onPress={() => void ai.run()} loading={ai.pending} testID="date-ai-run" />
          {aiIdeas.map((i) => (
            <View key={i.title} style={{ marginTop: spacing.sm }}>
              <Button variant="ghost" label={i.title} onPress={() => applyIdea(i, true)} />
              <Text variant="caption" color="textMuted">{i.safetyTip}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        {t('dates.propose')}
      </Text>
      <TextField testID="date-title" label={t('dates.fields.title')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField testID="date-venue" label={t('dates.fields.venue')} value={venue} onChangeText={setVenue} maxLength={200} />
      <DateField testID="date-day" label={t('dates.fields.date')} value={date} onChange={setDate} error={inPast ? t('dates.pastError') : null} />
      <TextField testID="date-time" label={t('dates.fields.time')} hint={t('dates.fields.timeHint')} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" error={time && !TIME.test(time) ? t('dates.fields.timeHint') : null} />
      <TextField testID="date-notes" label={t('dates.fields.notes')} value={notes} onChangeText={setNotes} multiline maxLength={1000} />
      <FormError error={create.error} />
      <Button testID="date-create" label={t('dates.send')} disabled={!title.trim() || !startsAt || inPast} loading={create.pending} onPress={() => void create.run()} />
    </Screen>
  );
}
