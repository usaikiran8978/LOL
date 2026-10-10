import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { client, isApiError, isConsentType, usersApi, type ConsentType } from '../../api';
import { verificationApi, type VerificationKind, type VerificationStarted } from '../../api/safety';
import { Badge, Button, Checkbox, FormError, Notice, Screen, Text } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDate, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/** Evidence the client asks for per kind (the server accepts up to 4 files and does not prescribe which). */
export const EVIDENCE_STEPS: Record<VerificationKind, Array<'selfie' | 'id_front' | 'id_back'>> = { selfie: ['selfie'], identity: ['id_front', 'id_back', 'selfie'] };

async function uploadEvidence(requestId: string, asset: { uri: string; mimeType?: string | null }) {
  const blob = await (await fetch(asset.uri)).blob();
  const mimeType = (asset.mimeType ?? blob.type) || 'image/jpeg';
  const ticket = await verificationApi.evidence(requestId, { mimeType: mimeType as 'image/jpeg', byteSize: blob.size });
  await client.upload(ticket.uploadUrl, ticket.method, ticket.headers, blob);
}

/**
 * Photo / ID verification. The API runs an evidence-upload flow (start → upload evidence → submit) and decides
 * through its configured provider (manual review by default), so the result arrives later by notification.
 */
export default function VerificationScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const state = useResource(verificationApi.status);
  const [kind, setKind] = useState<VerificationKind | null>(null);
  /** The consent POST /verification asked for (`details.consentType` of its 400 CONSENT_REQUIRED). */
  const [needsConsent, setNeedsConsent] = useState<ConsentType | null>(null);
  const [consented, setConsented] = useState(false);
  const [request, setRequest] = useState<VerificationStarted | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [cameraDenied, setCameraDenied] = useState(false);

  const start = useAction(async (k: VerificationKind) => {
    setKind(k);
    try {
      const r = await verificationApi.start(k);
      setRequest(r);
      setUploaded(0);
      setNeedsConsent(null);
      setConsented(false);
      analytics.track('verification_started', { kind: k });
    } catch (e) {
      if (isApiError(e, 'CONSENT_REQUIRED')) {
        const type = e.detail<string>('consentType');
        // Without a recognisable consent type there is nothing we could record; show the error instead of looping.
        if (isConsentType(type)) return setNeedsConsent(type);
      }
      throw e;
    }
  });

  const giveConsent = useAction(async () => {
    if (!kind || !needsConsent) return;
    await usersApi.setConsent({ consentType: needsConsent, granted: true });
    setNeedsConsent(null);
    await start.run(kind);
  });

  const capture = useAction(async () => {
    if (!request || !kind) return;
    const step = EVIDENCE_STEPS[kind][uploaded];
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setCameraDenied(true);
    setCameraDenied(false);
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, exif: false, cameraType: step === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
    const asset = shot.canceled ? undefined : shot.assets[0];
    if (!asset) return;
    await uploadEvidence(request.requestId, asset);
    setUploaded((n) => n + 1);
  });

  const submit = useAction(async () => {
    if (!request) return;
    state.setData(await verificationApi.submit(request.requestId));
    setRequest(null);
    setKind(null);
  });

  const s = state.data;
  const latest = s?.history[0];
  const inProgress = latest && (latest.status === 'processing' || latest.status === 'needs_review');
  const steps = kind ? EVIDENCE_STEPS[kind] : [];
  const nextStep = steps[uploaded];

  return (
    <Screen title={t('verification.title')} subtitle={t('verification.intro')} status={s ? 'ready' : state.status} error={state.error} onRetry={state.reload} testID="verification-screen">
      {s ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg }}>
            <Text variant="label">{t('verification.level')}</Text>
            <Badge tone={s.level === 'none' ? 'neutral' : 'success'} label={t(`verification.levels.${s.level}`)} testID="verification-level" />
          </View>
          {latest ? (
            <Notice
              testID="verification-latest"
              tone={latest.status === 'approved' ? 'success' : latest.status === 'rejected' ? 'danger' : 'info'}
              title={t(`verification.status.${latest.status}`)}
              body={latest.status === 'approved' && latest.expiresAt ? t('verification.validUntil', { date: formatDate(latest.expiresAt) }) : latest.rejectionReasonKey ? t('verification.rejectedHint') : undefined}
            />
          ) : null}

          {request && kind ? (
            <View testID="verification-capture">
              {request.poseChallenge ? <Notice tone="warning" title={t('verification.poseTitle')} body={t(`verification.poses.${request.poseChallenge}`, { defaultValue: t('verification.poseGeneric') })} testID="verification-pose" /> : null}
              <Text style={{ marginBottom: spacing.md }}>{t('verification.progress', { done: formatNumber(uploaded), total: formatNumber(steps.length) })}</Text>
              {cameraDenied ? <Notice tone="warning" title={t('verification.cameraDenied')} /> : null}
              <FormError error={capture.error ?? submit.error} />
              {nextStep ? (
                <Button testID="verification-capture-btn" label={t(`verification.capture.${nextStep}`)} onPress={() => void capture.run()} loading={capture.pending} />
              ) : (
                <Button testID="verification-submit" label={t('verification.submit')} onPress={() => void submit.run()} loading={submit.pending} />
              )}
            </View>
          ) : needsConsent && kind ? (
            <View testID="verification-consent">
              <Notice title={t('verification.consentTitle')} body={t(needsConsent === 'biometric_verification' ? 'verification.consentSelfie' : 'verification.consentIdentity')} />
              <Checkbox testID="verification-consent-check" label={t('verification.consentAgree')} checked={consented} onChange={setConsented} />
              <FormError error={giveConsent.error} />
              <Button testID="verification-consent-continue" label={t('common.continue')} disabled={!consented} loading={giveConsent.pending} onPress={() => void giveConsent.run()} />
            </View>
          ) : inProgress ? null : (
            <View style={{ gap: spacing.sm }}>
              <FormError error={start.error} />
              <Button testID="verification-start-selfie" label={t('verification.startSelfie')} onPress={() => void start.run('selfie')} loading={start.pending && kind === 'selfie'} />
              <Button testID="verification-start-identity" variant="secondary" label={t('verification.startIdentity')} onPress={() => void start.run('identity')} loading={start.pending && kind === 'identity'} />
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
