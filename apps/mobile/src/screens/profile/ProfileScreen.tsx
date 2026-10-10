import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, View } from 'react-native';
import { catalogApi, profileApi, type OwnProfile } from '../../api';
import { AI_FLAGS } from '../../api/ai';
import { useSession } from '../../auth/SessionProvider';
import { useFlag } from '../../config/ConfigProvider';
import { completeProfileHref } from '../../features/profile/completeProfile';
import { Button, Chip, ListItem, Notice, ProgressBar, Screen, Text } from '../../components';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatNumber, formatPercent, languageName } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

function Section({ title, editHref, children }: { title: string; editHref: Href; children: ReactNode }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading">{title}</Text>
        <Button variant="ghost" label={t('common.edit')} accessibilityHint={title} onPress={() => router.push(editHref)} />
      </View>
      {children}
    </View>
  );
}

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { spacing, radius } = useTheme();
  const router = useRouter();
  const coachOn = useFlag(AI_FLAGS.coach);
  const { user } = useSession();
  const profile = useResource(profileApi.me);
  const interests = useResource(catalogApi.interests, [i18n.language]);
  const prompts = useResource(catalogApi.prompts, [i18n.language]);
  // Edits happen on child screens; refresh when coming back.
  useRefreshOnFocus(profile.reload);

  const p = profile.data as OwnProfile | undefined;
  const interestLabel = (id: string) => interests.data?.flatMap((c) => c.interests).find((i) => i.id === id)?.label;
  const promptText = (id: string) => prompts.data?.find((x) => x.id === id)?.text ?? '';
  const status = !p ? (profile.status === 'error' ? 'error' : 'loading') : !p.exists ? 'empty' : 'ready';
  const photos = p?.media.filter((m) => m.kind === 'photo').sort((a, b) => a.position - b.position) ?? [];
  const attrs = p ? Object.values(p.attributes).flat() : [];
  const none = <Text color="textMuted">{t('profile.notSet')}</Text>;

  return (
    <Screen
      title={p?.displayName ?? t('profile.title')}
      subtitle={p?.age ? t('profile.age', { age: formatNumber(p.age) }) : undefined}
      status={status}
      error={profile.error}
      onRetry={profile.reload}
      emptyTitle={t('profile.emptyTitle')}
      emptyBody={t('profile.emptyBody')}
      testID="profile-screen"
    >
      {p ? (
        <>
          <ProgressBar value={p.completeness} label={t('profile.completeness', { percent: formatPercent(p.completeness) })} testID="completeness" />
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
            {t('profile.completeness', { percent: formatPercent(p.completeness) })}
          </Text>
          {p.completeness < 100 || !user?.onboardingCompleted ? (
            <Button label={t('home.completeProfile')} onPress={() => router.push(completeProfileHref(p, !!user?.onboardingCompleted))} testID="profile-complete" style={{ marginBottom: spacing.lg }} />
          ) : null}
          {p.moderationStatus === 'pending' ? <Notice title={t('moderation.profilePending')} /> : null}
          {p.moderationStatus === 'rejected' ? <Notice tone="danger" title={t('moderation.profileRejected')} /> : null}
          {p.moderationStatus === 'needs_changes' ? <Notice tone="warning" title={t('moderation.profileNeedsChanges')} /> : null}
          <Notice tone={p.discoverable ? 'success' : 'info'} title={p.discoverable ? t('profile.discoverable') : t('profile.notDiscoverable')} testID="discoverable" />

          <Section title={t('profile.sections.photos')} editHref="/profile/media">
            {photos.length ? (
              <ScrollView horizontal accessibilityRole="list">
                {photos.map((m, i) =>
                  m.thumbUrl || m.url ? (
                    <Image key={m.id} source={{ uri: m.thumbUrl ?? m.url! }} accessibilityLabel={t('media.photoN', { n: i + 1 })} style={{ width: 96, height: 128, borderRadius: radius.md, marginEnd: spacing.sm }} />
                  ) : (
                    <View key={m.id} style={{ width: 96, height: 128, marginEnd: spacing.sm, justifyContent: 'center' }}>
                      <Text variant="caption" color="textMuted" align="center">
                        {t(`media.processing.${m.processingStatus}`, { defaultValue: t('media.processing.unknown') })}
                      </Text>
                    </View>
                  ),
                )}
              </ScrollView>
            ) : (
              none
            )}
          </Section>

          <Section title={t('profile.sections.about')} editHref="/profile/edit">
            {p.bio ? <Text>{p.bio}</Text> : none}
            {[p.profession, p.employer, p.educationLevel?.label, p.school, p.heightCm ? t('profile.heightValue', { cm: formatNumber(p.heightCm) }) : null]
              .filter(Boolean)
              .map((x) => (
                <Text key={String(x)} color="textMuted">
                  {x}
                </Text>
              ))}
          </Section>

          <Section title={t('profile.sections.identity')} editHref="/profile/identity">
            {(['gender', 'orientation', 'datingIntent', 'relationshipGoal', 'relationshipStatus'] as const).map((k) => (
              <ListItem key={k} label={t(`profile.identity.${k}`)} value={p[k]?.label ?? t('profile.notSet')} />
            ))}
          </Section>

          <Section title={t('profile.sections.interests')} editHref="/profile/interests">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {p.interestIds.length ? p.interestIds.map((id) => <Chip key={id} label={interestLabel(id) ?? '…'} selected onPress={() => undefined} disabled />) : none}
            </View>
          </Section>

          <Section title={t('profile.sections.attributes')} editHref="/profile/attributes">
            {attrs.length ? <Text>{attrs.map((a) => a.label).join(' · ')}</Text> : none}
          </Section>

          <Section title={t('profile.sections.languages')} editHref="/profile/languages">
            {p.languages.length ? p.languages.map((l) => <ListItem key={l.code} label={languageName(l.code)} value={t(`languages.levels.${l.proficiency}`)} />) : none}
          </Section>

          <Section title={t('profile.sections.prompts')} editHref="/profile/prompts">
            {p.prompts.length
              ? p.prompts.map((pr) => (
                  <View key={pr.id} style={{ marginBottom: spacing.md }}>
                    <Text variant="label">{promptText(pr.promptId)}</Text>
                    <Text>{pr.answer}</Text>
                    {pr.moderationStatus !== 'approved' ? (
                      <Text variant="caption" color="textMuted">
                        {t(`moderation.${pr.moderationStatus === 'rejected' ? 'rejected' : 'pending'}`)}
                      </Text>
                    ) : null}
                  </View>
                ))
              : none}
          </Section>

          <Section title={t('profile.sections.location')} editHref="/profile/location">
            <Text color="textMuted">{p.cityId ? t('profile.citySet') : t('profile.notSet')}</Text>
          </Section>

          <ListItem label={t('profile.verification')} value={t(`profile.verificationLevels.${p.verificationLevel}`, { defaultValue: p.verificationLevel })} />
          <ListItem testID="profile-photo-verification" label={t('profile.photoVerification')} onPress={() => router.push('/safety/verification')} />
          <ListItem testID="profile-questionnaire" label={t('questionnaire.title')} onPress={() => router.push('/questionnaire')} />
          {coachOn ? <ListItem testID="profile-coach" label={t('ai.coachTitle')} onPress={() => router.push('/ai/coach')} /> : null}
          <ListItem testID="profile-safety" label={t('safety.center')} onPress={() => router.push('/safety')} />
        </>
      ) : null}
    </Screen>
  );
}
