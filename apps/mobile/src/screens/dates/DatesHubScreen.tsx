import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { discoveryApi } from '../../api/discovery';
import { datesApi, eventsApi } from '../../api/experiences';
import { Avatar, Button, type IconName, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation } from '../../theme/tokens';

function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void; testID?: string }; children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <Text variant="heading">{title}</Text>
        {action ? <Button variant="ghost" label={action.label} onPress={action.onPress} testID={action.testID} /> : null}
      </View>
      {children}
    </View>
  );
}

function FeatureCard({ icon, title, body, onPress, testID }: { icon: IconName; title: string; body: string; onPress: () => void; testID: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      style={({ pressed }) => [elevation.card, { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label">{title}</Text>
        <Text variant="caption" color="textMuted">
          {body}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * Dates tab: plan with a match, browse date ideas, your events, and date safety.
 * Note: there is no "all my upcoming date plans" endpoint yet (plans are per match: GET /dates/match/:id).
 */
export default function DatesHubScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const eventsOn = useFlag('events');
  const matches = useResource(() => discoveryApi.matches());
  const ideas = useResource(() => datesApi.ideas());
  const myEvents = useResource(() => eventsApi.list({ mine: true }), [], eventsOn);
  useRefreshOnFocus(matches.reload);

  return (
    <Screen testID="dates-hub-screen">
      <Text variant="label" color="accentText" style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {t('datesHub.eyebrow')}
      </Text>
      <Text variant="display">{t('datesHub.title')}</Text>
      <Text color="textMuted" style={{ marginBottom: spacing.xl }}>
        {t('datesHub.subtitle')}
      </Text>

      <Section title={t('datesHub.planWith')}>
        {matches.data?.items.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {matches.data.items.map((m) => (
              <Pressable
                key={m.matchId}
                testID={`dates-plan-${m.matchId}`}
                onPress={() => router.push({ pathname: '/dates/match/[matchId]', params: { matchId: m.matchId, name: m.partner.displayName ?? '' } })}
                accessibilityRole="button"
                accessibilityLabel={t('datesHub.planWithName', { name: m.partner.displayName ?? t('discover.someone') })}
                style={({ pressed }) => ({ alignItems: 'center', width: 76, opacity: pressed ? 0.8 : 1 })}
              >
                <View style={{ borderWidth: 2, borderColor: colors.accent, borderRadius: 36, padding: 2 }}>
                  <Avatar uri={m.partner.photo?.thumbUrl ?? m.partner.photo?.url} name={m.partner.displayName} size={60} />
                </View>
                <Text variant="caption" numberOfLines={1} style={{ marginTop: spacing.xs }}>
                  {m.partner.displayName ?? t('discover.someone')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.lg }} testID="dates-no-matches">
            <Text color="textMuted">{t('datesHub.noMatches')}</Text>
            <Button variant="secondary" label={t('tabs.discover')} onPress={() => router.push('/home')} style={{ marginTop: spacing.md }} />
          </View>
        )}
      </Section>

      {ideas.data?.length ? (
        <Section title={t('datesHub.ideas')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {ideas.data.slice(0, 8).map((idea) => (
              <View key={idea.key} testID={`dates-idea-${idea.key}`} style={[elevation.card, { width: 220, backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg }]}>
                <Ionicons name={idea.indoor ? 'cafe-outline' : 'sunny-outline'} size={22} color={colors.accent} />
                <Text variant="heading" color="onPrimary" style={{ marginTop: spacing.sm }} numberOfLines={2}>
                  {idea.title}
                </Text>
                <Text variant="caption" color="onPrimary" style={{ opacity: 0.85, marginTop: spacing.xxs }} numberOfLines={3}>
                  {idea.description}
                </Text>
                <Text variant="caption" color="onPrimary" style={{ marginTop: spacing.sm, opacity: 0.85 }}>
                  {t('datesHub.minutes', { minutes: formatNumber(idea.durationMin) })}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {eventsOn ? (
        <Section title={t('datesHub.yourEvents')} action={{ label: t('datesHub.browseEvents'), onPress: () => router.push('/events'), testID: 'dates-browse-events' }}>
          {myEvents.data?.items.length ? (
            myEvents.data.items.slice(0, 3).map((e) => (
              <FeatureCard key={e.id} icon="ticket-outline" title={e.title} body={formatDateTime(e.startsAt)} onPress={() => router.push({ pathname: '/events/[id]', params: { id: e.id } })} testID={`dates-event-${e.id}`} />
            ))
          ) : (
            <Text color="textMuted">{t('datesHub.noEvents')}</Text>
          )}
        </Section>
      ) : null}

      <Section title={t('datesHub.safety')}>
        <FeatureCard icon="shield-checkmark-outline" title={t('datesHub.safetyMode')} body={t('datesHub.safetyModeBody')} onPress={() => router.push('/safety/date')} testID="dates-safety" />
      </Section>
    </Screen>
  );
}
