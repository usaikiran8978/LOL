import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { aiApi, AI_FLAGS, type ProfileCoachResult } from '../../api/ai';
import { Button, ChipGroup, Notice, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { AiStatus, useAi } from '../../features/ai/useAi';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const FOCUS = ['overall', 'bio', 'prompts', 'photos'] as const;
const EDIT_ROUTE = { bio: '/profile/edit', prompts: '/profile/prompts', photos: '/profile/media', interests: '/profile/interests', details: '/profile/attributes' } as const;

/** AI profile coach: suggestions only — nothing is changed on the profile without the user editing it. */
export default function ProfileCoachScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const enabled = useFlag(AI_FLAGS.coach);
  const [focus, setFocus] = useState<(typeof FOCUS)[number]>('overall');
  const [result, setResult] = useState<ProfileCoachResult | null>(null);
  const coach = useAi('profile_coach', async (f: (typeof FOCUS)[number]) => {
    const r = await aiApi.profileCoach(f);
    setResult(r);
    return r;
  });

  if (!enabled) return <Screen title={t('ai.coachTitle')} status="empty" emptyTitle={t('ai.notConfiguredTitle')} emptyBody={t('ai.unavailableBody')} testID="coach-screen" />;

  return (
    <Screen title={t('ai.coachTitle')} subtitle={t('ai.coachIntro')} testID="coach-screen">
      <ChipGroup testID="coach-focus" label={t('ai.focus')} options={FOCUS.map((f) => ({ value: f, label: t(`ai.focusOptions.${f}`) }))} selected={[focus]} onChange={(v) => v[0] && setFocus(v[0] as (typeof FOCUS)[number])} />
      <AiStatus ai={coach} surface="profile_coach" />
      <Button testID="coach-run" label={t(result ? 'ai.again' : 'ai.getTips')} onPress={() => void coach.run(focus)} loading={coach.pending} />
      {result ? (
        <View testID="coach-result" style={{ marginTop: spacing.xl }}>
          <Text variant="heading">{t('ai.score', { score: formatNumber(result.score) })}</Text>
          {result.suggestions.map((s, i) => (
            <View key={`${s.area}-${i}`} style={{ marginTop: spacing.md }}>
              <Text variant="label">{t(`ai.areas.${s.area}`)}</Text>
              <Text>{s.tip}</Text>
              <Button variant="ghost" label={t('ai.editArea', { area: t(`ai.areas.${s.area}`) })} onPress={() => router.push(EDIT_ROUTE[s.area])} />
            </View>
          ))}
          {result.bioSuggestion ? <Notice title={t('ai.bioSuggestion')} body={result.bioSuggestion} testID="coach-bio" /> : null}
          <Text variant="caption" color="textMuted">{t('ai.disclaimer')}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
