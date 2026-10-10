import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';
import { client, mediaApi, type Media } from '../../api';
import { Button, FormError, Notice, Text, appAlert } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { LoadState, type EditorProps } from './LoadState';

const PENDING = new Set(['uploading', 'processing']);
const POLL_MS = 4000;

/** Signed-URL upload flow: request ticket → PUT bytes to storage → confirm → server processes + moderates async. */
export async function uploadPhoto(asset: { uri: string; mimeType?: string | null }): Promise<Media> {
  const blob = await (await fetch(asset.uri)).blob();
  const mimeType = asset.mimeType ?? (blob.type || 'image/jpeg');
  const ticket = await mediaApi.requestUpload({ kind: 'photo', mimeType, byteSize: blob.size });
  try {
    await client.upload(ticket.uploadUrl, ticket.method, ticket.headers, blob);
    return await mediaApi.confirm(ticket.mediaId);
  } catch (e) {
    // An unconfirmed row still counts towards the photo limit server-side; remove it so the user can retry.
    await mediaApi.remove(ticket.mediaId).catch(() => undefined);
    throw e;
  }
}

export function MediaManager({ submitLabel, onSaved }: EditorProps) {
  const media = useResource(mediaApi.list);
  const { status, data, reload } = media;
  // Keep refreshing while photos are still being processed so status badges update without user action.
  useEffect(() => {
    if (status !== 'ready' || !data?.some((m) => PENDING.has(m.processingStatus))) return;
    const id = setTimeout(reload, POLL_MS);
    return () => clearTimeout(id);
  }, [status, data, reload]);
  return <LoadState resources={[media]}>{() => <Manager items={media.data!} setItems={media.setData} submitLabel={submitLabel} onSaved={onSaved} />}</LoadState>;
}

function Manager({ items, setItems, submitLabel, onSaved }: EditorProps & { items: Media[]; setItems: (m: Media[]) => void }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const photos = items.filter((m) => m.kind === 'photo').sort((a, b) => a.position - b.position);
  const others = items.filter((m) => m.kind !== 'photo');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const add = useAction(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setPermissionDenied(true);
    setPermissionDenied(false);
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      exif: false,
      // iOS hands over HEIC by default; the server's image pipeline (sharp) decodes JPEG, not HEIC.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (pick.canceled || !pick.assets[0]) return;
    const created = await uploadPhoto(pick.assets[0]);
    setItems([...items, created]);
  });

  const reorder = useAction(async (from: number, to: number) => {
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    setItems(await mediaApi.reorder(ids));
  });

  const remove = useAction(async (id: string) => {
    await mediaApi.remove(id);
    setItems(items.filter((m) => m.id !== id));
  });

  const confirmRemove = (id: string) =>
    appAlert(t('media.deleteTitle'), t('media.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void remove.run(id) },
    ]);

  return (
    <View>
      <Text color="textMuted" style={{ marginBottom: spacing.md }}>
        {t('media.intro')}
      </Text>
      <FormError error={add.error ?? reorder.error ?? remove.error} />
      {permissionDenied ? <Notice tone="warning" title={t('media.permissionDenied')} testID="media-permission" /> : null}
      {photos.length === 0 ? (
        <Notice title={t('media.empty')} testID="media-empty" />
      ) : (
        photos.map((m, i) => (
          <View key={m.id} testID={`media-${m.id}`} style={[styles.row, { borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }]}>
            {m.thumbUrl || m.url ? (
              <Image source={{ uri: m.thumbUrl ?? m.url! }} style={[styles.thumb, { borderRadius: radius.sm }]} accessibilityLabel={t('media.photoN', { n: i + 1 })} />
            ) : (
              <View style={[styles.thumb, { borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }]} accessible accessibilityLabel={t('media.photoN', { n: i + 1 })} />
            )}
            <View style={{ flex: 1, marginStart: spacing.md }}>
              <Text variant="label">{t('media.photoN', { n: i + 1 })}</Text>
              <Text variant="caption" color={m.processingStatus === 'failed' ? 'danger' : 'textMuted'} testID={`media-status-${m.id}`}>
                {t(`media.processing.${m.processingStatus}`, { defaultValue: t('media.processing.unknown') })}
                {m.processingStatus === 'ready' ? ` · ${t(`media.moderation.${m.moderationStatus}`, { defaultValue: t('media.moderation.unknown') })}` : ''}
              </Text>
              <View style={[styles.actions, { gap: spacing.xs }]}>
                {i > 0 ? <Button variant="ghost" label={t('media.moveEarlier')} accessibilityHint={t('media.photoN', { n: i + 1 })} onPress={() => void reorder.run(i, i - 1)} /> : null}
                {i < photos.length - 1 ? <Button variant="ghost" label={t('media.moveLater')} accessibilityHint={t('media.photoN', { n: i + 1 })} onPress={() => void reorder.run(i, i + 1)} /> : null}
                <Button variant="ghost" label={t('common.delete')} accessibilityHint={t('media.photoN', { n: i + 1 })} onPress={() => confirmRemove(m.id)} testID={`media-delete-${m.id}`} />
              </View>
            </View>
          </View>
        ))
      )}
      {others.length ? <Notice title={t('media.otherKinds', { n: others.length })} /> : null}
      <Notice title={t('media.videoVoiceTitle')} body={t('common.comingSoonBody')} />
      <Button testID="media-add" variant="secondary" label={t('media.add')} onPress={() => void add.run()} loading={add.pending} />
      <View style={{ height: spacing.md }} />
      <Button testID="media-done" label={submitLabel} onPress={() => void onSaved()} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderWidth: 1, alignItems: 'flex-start' },
  thumb: { width: 72, height: 96 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
