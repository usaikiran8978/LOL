import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, Pressable, View } from 'react-native';
import { aiApi, AI_FLAGS } from '../../api/ai';
import { isApiError } from '../../api';
import { chatApi, type Message } from '../../api/chat';
import { useSession } from '../../auth/SessionProvider';
import { Badge, Button, FormError, Notice, Screen, Text, TextField } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { AiStatus, useAi } from '../../features/ai/useAi';
import { useChatThread, type ThreadMessage } from '../../features/chat/useChatThread';
import { useSafetyActions } from '../../features/safety/useSafetyActions';
import { useAction } from '../../hooks/useAction';
import { useErrorText } from '../../hooks/useErrorText';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { conversationTitle } from './ChatsScreen';

export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢'] as const;

/** Conversation thread: messages, composer, media, reactions, icebreakers, AI starters/translation, calls, safety. */
export default function ChatScreen() {
  const { t, i18n } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const me = user?.id ?? null;

  // Partner, match and status come from the single-conversation endpoint (works for deep links, push taps, restarts).
  const meta = useResource(() => chatApi.conversation(id!), [id]);
  const conv = meta.data ?? null;
  // 404: not (or no longer) a member — show it as the screen's error instead of an empty thread.
  const notFound = meta.status === 'error' && isApiError(meta.error, 'NOT_FOUND');
  const partner = conv?.participants[0] ?? null;
  const title = conv ? (conv.kind === 'event' ? t('chat.eventChat') : conversationTitle(conv, nameParam || t('discover.someone'))) : nameParam || t('chat.title');

  const thread = useChatThread(id!, me, conv?.matchId ?? null);
  const closed = thread.closed || conv?.status === 'closed';
  const [text, setText] = useState('');
  const [aiText, setAiText] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [starterList, setStarterList] = useState<string[]>([]);
  const errorText = useErrorText();

  const startersOn = useFlag(AI_FLAGS.starters);
  const translateOn = useFlag(AI_FLAGS.translation);
  const voiceOn = useFlag('voice_calls');
  const videoOn = useFlag('video_calls');

  const icebreakers = useResource(() => chatApi.icebreakers(id!), [id], thread.status === 'ready' && thread.messages.length === 0 && !closed);
  const starters = useAi('conversation_starter', async () => {
    const r = await aiApi.conversationStarters({ conversationId: id! });
    setStarterList(r.starters);
    return r;
  });
  const translate = useAi('translation', async (m: Message) => {
    const r = await aiApi.translate(m.id, i18n.language);
    setTranslations((cur) => ({ ...cur, [m.id]: r.translation }));
    return r;
  });
  const safety = useSafetyActions({ userId: partner?.userId ?? '', name: partner?.displayName ?? null, matchId: conv?.matchId }, { onBlocked: () => thread.setClosed(true), onUnmatched: () => router.replace('/chats') });
  const reaction = useAction((m: Message, emoji: string) => thread.toggleReaction(m, emoji));
  const removeMsg = useAction((m: Message) => thread.remove(m));

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    // AI suggestions are only ever sent by the user; flag the message when the suggestion was used unchanged.
    thread.send({ kind: 'text', body, aiAssisted: aiText !== null && body === aiText.trim() });
    setText('');
    setAiText(null);
    thread.setTyping(false);
  };

  const pickImage = useAction(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setPermissionDenied(true);
    setPermissionDenied(false);
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      exif: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible, // JPEG, not HEIC
    });
    const asset = pick.canceled ? undefined : pick.assets[0];
    if (asset) thread.send({ kind: 'image', file: { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' } });
  });

  const myLastRead = thread.readUpTo;

  const renderMessage = ({ item: m }: { item: ThreadMessage }) => {
    const mine = m.senderId === me;
    const isSelected = selected === m.id;
    const reactionCounts = m.reactions.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] ?? 0) + 1 }), {});
    const img = m.media.find((x) => x.kind === 'image')?.url ?? m.localUri;
    const invite = m.kind === 'date_invite';
    const body = invite ? t('chat.kinds.date_invite') : m.body;
    return (
      <View testID={`message-${m.clientMessageId ?? m.id}`} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: spacing.xs }}>
        <Pressable
          onPress={() => !m.local && !m.deleted && setSelected(isSelected ? null : m.id)}
          accessibilityRole="button"
          accessibilityLabel={[mine ? t('chat.you') : title, m.deleted ? t('chat.deleted') : m.kind === 'date_invite' ? t('chat.kinds.date_invite') : (m.body ?? t(`chat.kinds.${m.kind}`, { defaultValue: t('chat.kinds.other') }))].join(': ')}
          accessibilityHint={t('chat.messageActionsHint')}
          style={{ maxWidth: '85%', backgroundColor: mine ? colors.primary : colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.md }}
        >
          {m.deleted ? (
            <Text color={mine ? 'onPrimary' : 'textMuted'}>{t('chat.deleted')}</Text>
          ) : (
            <>
              {img ? <Image source={{ uri: img }} style={{ width: 200, height: 200, borderRadius: radius.md }} accessibilityLabel={t('chat.kinds.image')} /> : null}
              {body ? <Text color={mine ? 'onPrimary' : 'text'}>{body}</Text> : null}
              {invite && conv?.matchId ? <Button variant="ghost" label={t('dates.view')} onPress={() => router.push({ pathname: '/dates/match/[matchId]', params: { matchId: conv.matchId!, name: title } })} /> : null}
              {!img && !body ? <Text color={mine ? 'onPrimary' : 'textMuted'}>{t(`chat.kinds.${m.kind}`, { defaultValue: t('chat.kinds.other') })}</Text> : null}
              {translations[m.id] ? (
                <Text variant="caption" color={mine ? 'onPrimary' : 'textMuted'} style={{ marginTop: spacing.xs }} testID={`translation-${m.id}`}>
                  {t('chat.translated', { text: translations[m.id] })}
                </Text>
              ) : null}
            </>
          )}
        </Pressable>
        {m.safetyWarning && !mine ? <Text variant="caption" color="warning">{t('chat.safetyWarning')}</Text> : null}
        {Object.keys(reactionCounts).length ? <Text variant="caption">{Object.entries(reactionCounts).map(([e, n]) => (n > 1 ? `${e}${n}` : e)).join(' ')}</Text> : null}
        {m.local === 'sending' ? <Text variant="caption" color="textMuted">{t('chat.sending')}</Text> : null}
        {m.local === 'failed' ? (
          <View style={{ alignItems: 'flex-end' }} testID={`failed-${m.clientMessageId}`}>
            <Text variant="caption" color="danger">{errorText(m.error) ?? t('chat.failed')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Button variant="ghost" label={t('common.retry')} onPress={() => thread.retry(m.clientMessageId!)} testID={`retry-${m.clientMessageId}`} />
              <Button variant="ghost" label={t('common.delete')} onPress={() => thread.discard(m.clientMessageId!)} />
            </View>
          </View>
        ) : null}
        {mine && !m.local && myLastRead === m.id ? <Text variant="caption" color="textMuted" testID="read-receipt">{t('chat.read')}</Text> : null}
        {isSelected ? (
          <View testID={`actions-${m.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            {!closed
              ? REACTIONS.map((e) => (
                  <Pressable key={e} onPress={() => void reaction.run(m, e)} accessibilityRole="button" accessibilityLabel={t('chat.react', { emoji: e })} testID={`react-${m.id}-${e}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Text>{e}</Text>
                  </Pressable>
                ))
              : null}
            {!mine && translateOn && m.body && !invite ? <Button variant="ghost" label={t('chat.translate')} onPress={() => void translate.run(m)} loading={translate.pending} testID={`translate-${m.id}`} /> : null}
            {!mine && partner ? <Button variant="ghost" label={t('safety.reportMessage')} onPress={() => safety.report({ targetType: 'message', targetId: m.id })} testID={`report-${m.id}`} /> : null}
            {mine ? <Button variant="ghost" label={t('common.delete')} onPress={() => void removeMsg.run(m)} /> : null}
          </View>
        ) : null}
      </View>
    );
  };

  const header = (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {partner ? <Button variant="ghost" label={t('chat.viewProfile')} onPress={() => router.push({ pathname: '/users/[id]', params: { id: partner.userId, matchId: conv?.matchId ?? '', conversationId: id!, surface: 'chat' } })} testID="chat-profile" /> : null}
        {!closed && voiceOn ? <Button variant="ghost" label={t('calls.voice')} onPress={() => router.push({ pathname: '/call', params: { conversationId: id!, kind: 'voice', name: title } })} testID="call-voice" /> : null}
        {!closed && videoOn ? <Button variant="ghost" label={t('calls.video')} onPress={() => router.push({ pathname: '/call', params: { conversationId: id!, kind: 'video', name: title } })} testID="call-video" /> : null}
        {conv?.matchId && !closed ? <Button variant="ghost" label={t('dates.plan')} onPress={() => router.push({ pathname: '/dates/match/[matchId]', params: { matchId: conv.matchId!, name: title } })} testID="chat-plan-date" /> : null}
        <Button variant="ghost" label={t('safety.title')} onPress={() => router.push('/safety')} testID="chat-safety" />
        {partner ? <Button variant="ghost" label={t('safety.block')} onPress={safety.confirmBlock} testID="chat-block" /> : null}
      </View>
      {!thread.live && thread.status === 'ready' ? <Text variant="caption" color="textMuted" testID="chat-polling">{t('chat.reconnecting')}</Text> : null}
      <FormError error={safety.error ?? reaction.error ?? removeMsg.error ?? pickImage.error} />
      {permissionDenied ? <Notice tone="warning" title={t('media.permissionDenied')} /> : null}
    </View>
  );

  const composer = closed ? (
    <Notice tone="warning" title={t('chat.closed')} testID="chat-closed" />
  ) : (
    <View>
      <AiStatus ai={starters} surface="chat" testID="starters" />
      <AiStatus ai={translate} surface="chat" testID="translate" />
      {thread.typing ? <Text variant="caption" color="textMuted">{t('chat.typing', { name: title })}</Text> : null}
      <TextField
        testID="chat-input"
        label={t('chat.messageLabel')}
        value={text}
        onChangeText={(v) => {
          setText(v);
          thread.setTyping(v.length > 0);
        }}
        multiline
        maxLength={4000}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Button style={{ flex: 1 }} label={t('chat.send')} onPress={sendText} disabled={!text.trim()} testID="chat-send" />
        <Button variant="secondary" label={t('chat.photo')} onPress={() => void pickImage.run()} loading={pickImage.pending} testID="chat-photo" />
        {startersOn ? <Button variant="secondary" label={t('chat.ideas')} onPress={() => void starters.run()} loading={starters.pending} testID="chat-starters" /> : null}
      </View>
    </View>
  );

  return (
    <Screen
      title={title}
      header={notFound ? undefined : header}
      status={notFound ? 'error' : thread.status}
      error={notFound ? meta.error : thread.error}
      onRetry={notFound ? meta.reload : thread.reload}
      scroll={false} footer={composer} testID="chat-screen">
      {starterList.length ? (
        <View testID="starter-list" style={{ marginBottom: spacing.sm }}>
          <Text variant="label">{t('chat.ideasTitle')}</Text>
          <Text variant="caption" color="textMuted">{t('chat.ideasHint')}</Text>
          {starterList.map((s, i) => (
            <Button key={s} variant="ghost" label={s} onPress={() => { setText(s); setAiText(s); setStarterList([]); }} testID={`starter-${i}`} />
          ))}
        </View>
      ) : null}
      {thread.messages.length === 0 && !closed ? (
        <View testID="chat-empty">
          <Text variant="heading">{t('chat.startTitle', { name: title })}</Text>
          {icebreakers.data?.length ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text color="textMuted">{t('chat.icebreakers')}</Text>
              {icebreakers.data.map((ib) => (
                <Button key={ib.key} variant="secondary" label={ib.text} onPress={() => thread.send({ kind: 'icebreaker', body: ib.text })} testID={`icebreaker-${ib.key}`} style={{ marginTop: spacing.sm }} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <FlatList
        inverted
        data={thread.messages}
        keyExtractor={(m) => m.clientMessageId ?? m.id}
        renderItem={renderMessage}
        onEndReached={() => void thread.loadOlder()}
        ListFooterComponent={
          <View>
            <FormError error={thread.olderError} />
            {thread.hasOlder ? <Button variant="ghost" label={t('chat.older')} onPress={() => void thread.loadOlder()} loading={thread.loadingOlder} testID="chat-older" /> : null}
          </View>
        }
      />
      {conv?.muted ? <Badge label={t('chat.muted')} /> : null}
    </Screen>
  );
}
