import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError } from '../../api/errors';
import { dateSafetyApi, type TrustedContact } from '../../api/safety';
import { Badge, Button, FormError, Notice, Screen, Text, TextField, appAlert } from '../../components';
import { useToast } from '../../components/Toast';
import { useFlag } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trusted contacts get an invite (SMS or email) and must confirm before they can be used for a date check-in. */
export default function TrustedContactsScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const enabled = useFlag('date_safety');
  const contacts = useResource(dateSafetyApi.contacts, [], enabled);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [adding, setAdding] = useState(false);
  /** The admin-set maximum, learned from a 429 LIMIT_REACHED (the server is the only source of it). */
  const [limit, setLimit] = useState<number | null>(null);
  const [resendNote, setResendNote] = useState<{ id: string; text: string } | null>(null);
  const toast = useToast();

  const phoneErr = phone && !E164.test(phone.trim()) ? t('validation.phone') : null;
  const emailErr = email && !EMAIL.test(email.trim()) ? t('validation.email') : null;
  const valid = name.trim().length > 0 && (phone.trim() || email.trim()) && !phoneErr && !emailErr;

  const add = useAction(async () => {
    let list: TrustedContact[];
    try {
      list = await dateSafetyApi.addContact({ name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, relationship: relationship.trim() || undefined });
    } catch (e) {
      if (isApiError(e, 'LIMIT_REACHED')) {
        setLimit(e.detail<number>('limit') ?? (contacts.data ?? []).length);
        setAdding(false);
        return;
      }
      throw e;
    }
    contacts.setData(list);
    setName('');
    setPhone('');
    setEmail('');
    setRelationship('');
    setAdding(false);
  });
  const remove = useAction(async (id: string) => {
    await dateSafetyApi.removeContact(id);
    contacts.setData((contacts.data ?? []).filter((c) => c.id !== id));
    setLimit(null);
  });
  const resend = useAction(async (c: TrustedContact) => {
    setResendNote(null);
    try {
      contacts.setData(await dateSafetyApi.resendContact(c.id));
      toast.show(t('trustedContacts.resent', { name: c.name }), 'success');
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED')) {
        const minutes = e.detail<number>('retryAfterMin') ?? (e.retryAfterSeconds ? Math.ceil(e.retryAfterSeconds / 60) : null);
        if (minutes) return setResendNote({ id: c.id, text: t('trustedContacts.resendWait', { minutes: formatNumber(minutes) }) });
      }
      if (isApiError(e, 'CONFLICT')) {
        // Confirmed in the meantime: show the fresh state.
        setResendNote({ id: c.id, text: t('trustedContacts.alreadyConfirmed', { name: c.name }) });
        contacts.reload();
        return;
      }
      throw e;
    }
  });

  if (!enabled) {
    return <Screen title={t('trustedContacts.title')} status="empty" emptyTitle={t('dateSafety.unavailable')} testID="contacts-screen" />;
  }

  const list = contacts.data ?? [];
  return (
    <Screen title={t('trustedContacts.title')} subtitle={t('trustedContacts.intro')} status={contacts.data ? 'ready' : contacts.status} error={contacts.error} onRetry={contacts.reload} testID="contacts-screen">
      {list.length === 0 ? <Notice title={t('trustedContacts.empty')} testID="contacts-empty" /> : null}
      <FormError error={remove.error ?? resend.error} />
      {list.map((c) => (
        <View key={c.id} testID={`contact-${c.id}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}>
            <Text>{c.relationship ? t('trustedContacts.nameWithRelation', { name: c.name, relationship: c.relationship }) : c.name}</Text>
            <Text variant="caption" color="textMuted">
              {[c.phoneMasked, c.emailMasked].filter(Boolean).join(' · ')}
            </Text>
            <Badge tone={c.confirmed ? 'success' : 'warning'} label={t(c.confirmed ? 'trustedContacts.confirmed' : 'trustedContacts.pending')} testID={`contact-status-${c.id}`} />
            {resendNote?.id === c.id ? (
              <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite" testID={`contact-resend-note-${c.id}`}>
                {resendNote.text}
              </Text>
            ) : null}
          </View>
          {!c.confirmed ? (
            <Button
              variant="ghost"
              label={t('trustedContacts.resend')}
              accessibilityHint={t('trustedContacts.resendA11y', { name: c.name })}
              onPress={() => void resend.run(c)}
              loading={resend.pending}
              testID={`contact-resend-${c.id}`}
            />
          ) : null}
          <Button
            variant="ghost"
            label={t('common.delete')}
            accessibilityHint={c.name}
            onPress={() =>
              appAlert(t('trustedContacts.removeTitle', { name: c.name }), t('trustedContacts.removeBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: () => void remove.run(c.id) },
              ])
            }
            testID={`contact-remove-${c.id}`}
          />
        </View>
      ))}
      {list.some((c) => !c.confirmed) ? <Notice title={t('trustedContacts.pendingHint')} /> : null}

      {adding ? (
        <View style={{ marginTop: spacing.xl }} testID="contact-form">
          <TextField testID="contact-name" label={t('trustedContacts.name')} value={name} onChangeText={setName} maxLength={80} />
          <TextField testID="contact-phone" label={t('trustedContacts.phone')} hint={t('trustedContacts.phoneHint')} error={phoneErr} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextField testID="contact-email" label={t('trustedContacts.email')} error={emailErr} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
          <TextField testID="contact-relationship" label={t('trustedContacts.relationship')} value={relationship} onChangeText={setRelationship} maxLength={50} />
          <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>
            {t('trustedContacts.inviteNote')}
          </Text>
          <FormError error={add.error} />
          <Button testID="contact-save" label={t('trustedContacts.invite')} disabled={!valid} loading={add.pending} onPress={() => void add.run()} />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setAdding(false)} style={{ marginTop: spacing.sm }} />
        </View>
      ) : limit !== null && list.length >= limit ? (
        <Notice tone="warning" title={t('trustedContacts.limitReached', { limit: formatNumber(limit) })} testID="contacts-limit" />
      ) : (
        <Button testID="contact-add" label={t('trustedContacts.add')} onPress={() => setAdding(true)} style={{ marginTop: spacing.xl }} />
      )}
    </Screen>
  );
}
