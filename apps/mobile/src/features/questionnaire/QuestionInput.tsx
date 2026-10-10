import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { AnswerValue, Question } from '../../api/questionnaire';
import { Button, ChipGroup, Text, TextField, ToggleRow } from '../../components';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/** Editable draft of one answer; converted to the API payload by `toSubmission`. */
export interface AnswerDraft {
  selected: string[];
  ranked: string[];
  scale: number | null;
  rangeMin: string;
  rangeMax: string;
  text: string;
  acceptable: string[];
  importance: number | null;
  dealbreaker: boolean;
}

const CHOICE = new Set(['single_choice', 'multiple_choice', 'yes_no']);

export function initialDraft(q: Question): AnswerDraft {
  const v = (q.answer?.value ?? {}) as Partial<Record<string, unknown>>;
  return {
    selected: typeof v.optionKey === 'string' ? [v.optionKey] : Array.isArray(v.optionKeys) ? (v.optionKeys as string[]) : [],
    ranked: Array.isArray(v.rankedOptionKeys) ? (v.rankedOptionKeys as string[]) : q.options.map((o) => o.key),
    scale: typeof v.value === 'number' ? v.value : null,
    rangeMin: typeof v.min === 'number' ? String(v.min) : '',
    rangeMax: typeof v.max === 'number' ? String(v.max) : '',
    text: typeof v.text === 'string' ? v.text : '',
    acceptable: Array.isArray(v.acceptableOptionKeys) ? (v.acceptableOptionKeys as string[]) : [],
    importance: q.answer?.importance ?? null,
    dealbreaker: q.answer?.isDealbreaker ?? false,
  };
}

/** The answer payload, or null when the draft is not answerable yet (the Save button stays disabled). */
export function toValue(q: Question, d: AnswerDraft): AnswerValue | null {
  switch (q.answerType) {
    case 'single_choice':
    case 'yes_no':
      return d.selected[0] ? { optionKey: d.selected[0] } : null;
    case 'multiple_choice': {
      const min = q.constraints.minSelections ?? 1;
      return d.selected.length >= min ? { optionKeys: d.selected } : null;
    }
    case 'scale':
      return d.scale === null ? null : { value: d.scale };
    case 'numeric_range': {
      const min = Number(d.rangeMin);
      const max = Number(d.rangeMax);
      if (d.rangeMin.trim() === '' || d.rangeMax.trim() === '' || !Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
      return { min, max };
    }
    case 'ranking':
      return d.ranked.length ? { rankedOptionKeys: d.ranked } : null;
    case 'text':
      return d.text.trim() ? { text: d.text.trim() } : null;
    case 'structured_preference':
      return d.selected.length && d.acceptable.length ? { optionKeys: d.selected, acceptableOptionKeys: d.acceptable } : null;
    default:
      return null;
  }
}

/** Partner-acceptable answers apply to choice questions; a choice deal-breaker requires them (ANSWER_INVALID otherwise). */
export function acceptableFor(q: Question, d: AnswerDraft): string[] | undefined {
  if (!CHOICE.has(q.answerType) || !d.dealbreaker) return undefined;
  return d.acceptable;
}

export function draftComplete(q: Question, d: AnswerDraft): boolean {
  if (!toValue(q, d)) return false;
  if (d.dealbreaker && CHOICE.has(q.answerType) && d.acceptable.length === 0) return false;
  return true;
}

function scaleValues(q: Question): number[] {
  const { scaleMin, scaleMax, scaleStep } = q.constraints;
  if (scaleMin === null || scaleMax === null) return [];
  const step = scaleStep && scaleStep > 0 ? scaleStep : 1;
  const out: number[] = [];
  for (let v = scaleMin; v <= scaleMax && out.length < 101; v += step) out.push(v);
  return out;
}

export function QuestionInput({ question: q, draft: d, onChange }: { question: Question; draft: AnswerDraft; onChange: (next: AnswerDraft) => void }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const set = (patch: Partial<AnswerDraft>) => onChange({ ...d, ...patch });
  const options = q.options.map((o) => ({ value: o.key, label: o.label }));
  const exclusive = new Set(q.options.filter((o) => o.isExclusive).map((o) => o.key));

  // An exclusive option ("none of these") cannot be combined with others.
  const multiChange = (next: string[]) => {
    const added = next.find((k) => !d.selected.includes(k));
    if (added && exclusive.has(added)) return set({ selected: [added] });
    set({ selected: next.filter((k) => !exclusive.has(k) || next.length === 1) });
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...d.ranked];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ ranked: next });
  };
  const optionLabel = (key: string) => q.options.find((o) => o.key === key)?.label ?? key;

  let input;
  switch (q.answerType) {
    case 'single_choice':
    case 'yes_no':
      input = <ChipGroup testID="q-options" label={t('questionnaire.yourAnswer')} options={options} selected={d.selected} onChange={(v) => set({ selected: v })} />;
      break;
    case 'multiple_choice':
      input = (
        <ChipGroup
          testID="q-options"
          multiple
          max={q.constraints.maxSelections ?? undefined}
          label={t('questionnaire.yourAnswer')}
          hint={q.constraints.maxSelections ? t('questionnaire.chooseUpTo', { count: formatNumber(q.constraints.maxSelections) }) : t('common.chooseAny')}
          options={options}
          selected={d.selected}
          onChange={multiChange}
        />
      );
      break;
    case 'structured_preference':
      input = (
        <>
          <ChipGroup testID="q-options" multiple label={t('questionnaire.yourAnswer')} options={options} selected={d.selected} onChange={(v) => set({ selected: v })} />
          <ChipGroup testID="q-acceptable" multiple label={t('questionnaire.acceptable')} hint={t('questionnaire.acceptableHint')} options={options} selected={d.acceptable} onChange={(v) => set({ acceptable: v })} />
        </>
      );
      break;
    case 'scale': {
      const values = scaleValues(q);
      input = (
        <View>
          <ChipGroup testID="q-scale" label={t('questionnaire.yourAnswer')} options={values.map((v) => ({ value: String(v), label: formatNumber(v) }))} selected={d.scale === null ? [] : [String(d.scale)]} onChange={(v) => set({ scale: v[0] === undefined ? null : Number(v[0]) })} />
          {q.scaleMinLabel || q.scaleMaxLabel ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.sm, marginBottom: spacing.lg }}>
              <Text variant="caption" color="textMuted">
                {q.scaleMinLabel ?? ''}
              </Text>
              <Text variant="caption" color="textMuted">
                {q.scaleMaxLabel ?? ''}
              </Text>
            </View>
          ) : null}
        </View>
      );
      break;
    }
    case 'numeric_range': {
      const { numericMin: lo, numericMax: hi } = q.constraints;
      const unit = q.constraints.numericUnit?.trim() || null;
      const hint =
        lo !== null && hi !== null
          ? unit
            ? t('questionnaire.betweenUnit', { min: formatNumber(lo), max: formatNumber(hi), unit })
            : t('questionnaire.between', { min: formatNumber(lo), max: formatNumber(hi) })
          : undefined;
      const withUnit = (label: string) => (unit ? t('questionnaire.withUnit', { label, unit }) : label);
      input = (
        <View>
          <TextField testID="q-range-min" label={withUnit(t('questionnaire.rangeMin'))} hint={hint} keyboardType="numeric" value={d.rangeMin} onChangeText={(v) => set({ rangeMin: v })} />
          <TextField testID="q-range-max" label={withUnit(t('questionnaire.rangeMax'))} keyboardType="numeric" value={d.rangeMax} onChangeText={(v) => set({ rangeMax: v })} />
        </View>
      );
      break;
    }
    case 'ranking':
      input = (
        <View accessibilityRole="list" accessibilityLabel={t('questionnaire.rankHint')} style={{ marginBottom: spacing.lg }}>
          <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.sm }}>
            {t('questionnaire.rankHint')}
          </Text>
          {d.ranked.map((key, i) => (
            <View key={key} testID={`q-rank-${key}`} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs }}>
              <Text variant="label" style={{ width: 28 }}>
                {formatNumber(i + 1)}
              </Text>
              <Text style={{ flex: 1 }}>{optionLabel(key)}</Text>
              <Button variant="ghost" label={t('questionnaire.moveUp')} accessibilityHint={optionLabel(key)} disabled={i === 0} onPress={() => move(i, -1)} testID={`q-rank-up-${key}`} />
              <Button variant="ghost" label={t('questionnaire.moveDown')} accessibilityHint={optionLabel(key)} disabled={i === d.ranked.length - 1} onPress={() => move(i, 1)} testID={`q-rank-down-${key}`} />
            </View>
          ))}
        </View>
      );
      break;
    case 'text':
      input = <TextField testID="q-text" label={t('questionnaire.yourAnswer')} multiline maxLength={q.constraints.textMaxLength ?? 2000} value={d.text} onChangeText={(v) => set({ text: v })} />;
      break;
    default:
      input = <Text color="textMuted">{t('questionnaire.unsupported')}</Text>;
  }

  return (
    <View>
      {input}
      {q.allowImportance ? (
        <ChipGroup
          testID="q-importance"
          label={t('questionnaire.importance')}
          options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: t(`questionnaire.importanceLevels.${n}`) }))}
          selected={d.importance === null ? [] : [String(d.importance)]}
          onChange={(v) => set({ importance: v[0] === undefined ? null : Number(v[0]) })}
        />
      ) : null}
      {q.allowDealbreaker ? (
        <ToggleRow testID="q-dealbreaker" label={t('questionnaire.dealbreaker')} description={t('questionnaire.dealbreakerHint')} value={d.dealbreaker} onChange={(v) => set({ dealbreaker: v })} />
      ) : null}
      {q.allowDealbreaker && d.dealbreaker && CHOICE.has(q.answerType) ? (
        <View style={{ marginTop: spacing.md }}>
          <ChipGroup testID="q-acceptable" multiple label={t('questionnaire.acceptable')} hint={t('questionnaire.acceptableHint')} options={options} selected={d.acceptable} onChange={(v) => set({ acceptable: v })} />
        </View>
      ) : null}
    </View>
  );
}

/** Pressable summary row used in the category overview. */
export function QuestionRow({ question, onPress }: { question: Question; onPress: () => void }) {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const state = question.needsReanswer ? 'needsReanswer' : question.answer ? (question.answer.skipped ? 'skipped' : 'answered') : 'unanswered';
  return (
    <Pressable
      testID={`question-${question.key}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${question.text}, ${t(`questionnaire.state.${state}`)}`}
      style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <Text>{question.text}</Text>
      <Text variant="caption" color={state === 'needsReanswer' ? 'warning' : 'textMuted'}>
        {t(`questionnaire.state.${state}`)}
      </Text>
    </Pressable>
  );
}
