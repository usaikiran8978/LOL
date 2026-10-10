import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { catalogApi, profileApi, type OwnProfile, type PromptOption } from '../../api';
import { Button, FormError, Notice, Select, Text, TextField } from '../../components';
import { useSetting } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import type { FieldErrors } from '../../utils/validation';
import { LoadState, type EditorProps } from './LoadState';

const CONTRACT_MAX = 3; // promptsUpdate max; admins can lower it via public.max_prompts

export function PromptsEditor(props: EditorProps) {
  const { i18n } = useTranslation();
  const profile = useResource(profileApi.me);
  const catalog = useResource(catalogApi.prompts, [i18n.language]);
  return <LoadState resources={[profile, catalog]}>{() => <Editor {...props} profile={profile.data!} catalog={catalog.data!} />}</LoadState>;
}

type Item = { promptId: string; answer: string };

function Editor({ profile, catalog, submitLabel, onSaved, registerDraft, draft }: EditorProps & { profile: OwnProfile; catalog: PromptOption[] }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const max = Math.min(CONTRACT_MAX, useSetting<number>('max_prompts', CONTRACT_MAX));
  const [items, setItems] = useState<Item[]>(() => (draft?.items as Item[] | undefined) ?? profile.prompts.map((p) => ({ promptId: p.promptId, answer: p.answer })));
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => registerDraft?.(() => ({ items })), [registerDraft, items]);
  const text = (id: string) => catalog.find((p) => p.id === id)?.text ?? '';
  const status = (id: string) => profile.prompts.find((p) => p.promptId === id)?.moderationStatus;

  const save = useAction(async () => {
    const errs: FieldErrors = {};
    items.forEach((i, idx) => {
      if (!i.answer.trim()) errs[`answer${idx}`] = t('validation.required');
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    await profileApi.setPrompts({ prompts: items.map((i) => ({ promptId: i.promptId, answer: i.answer.trim() })) });
    await onSaved();
  });

  return (
    <>
      <Text color="textMuted" style={{ marginBottom: spacing.md }}>
        {t('prompts.intro', { max })}
      </Text>
      <FormError error={save.error} />
      {items.map((item, idx) => (
        <View key={item.promptId} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>
            {text(item.promptId)}
          </Text>
          {status(item.promptId) === 'pending' ? <Notice title={t('moderation.pending')} /> : null}
          {status(item.promptId) === 'rejected' ? <Notice tone="danger" title={t('moderation.rejected')} /> : null}
          <TextField
            testID={`prompt-answer-${idx}`}
            label={t('prompts.answer')}
            value={item.answer}
            onChangeText={(v) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, answer: v } : x)))}
            multiline
            maxLength={300}
            error={errors[`answer${idx}`]}
          />
          <Button variant="ghost" label={t('prompts.remove')} onPress={() => setItems((s) => s.filter((_, i) => i !== idx))} />
        </View>
      ))}
      {items.length < max ? (
        <Select
          testID="prompt-add"
          label={t('prompts.add')}
          value={null}
          options={catalog.filter((p) => !items.some((i) => i.promptId === p.id)).map((p) => ({ value: p.id, label: p.text }))}
          onChange={(promptId) => setItems((s) => [...s, { promptId, answer: '' }])}
        />
      ) : null}
      <Button testID="prompts-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
