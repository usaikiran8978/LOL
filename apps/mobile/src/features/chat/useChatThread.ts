import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { analytics } from '../../analytics';
import { client, isApiError } from '../../api';
import { chatApi, type MatchEndedEvent, type Message, type MessageKind } from '../../api/chat';
import { useRealtime, useRealtimeEvent } from '../../realtime/RealtimeProvider';

export type LocalState = 'sending' | 'failed';
/** A message as rendered: server messages, plus optimistic ones that carry a local state and preview URI. */
export interface ThreadMessage extends Message {
  local?: LocalState;
  localUri?: string;
  error?: unknown;
}

interface Pending {
  kind: Exclude<MessageKind, 'gif' | 'voice'>;
  body?: string;
  aiAssisted?: boolean;
  /** Image messages: picked file, uploaded on (re)send. */
  file?: { uri: string; mimeType: string };
  uploadToken?: string;
}

/** Polling interval while the realtime socket is not connected. */
export const POLL_MS = 5000;

const byNewest = (a: Message, b: Message) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** Merge server messages into the list: dedupe by id and replace optimistic copies by clientMessageId. */
export function mergeMessages(current: ThreadMessage[], incoming: Message[]): ThreadMessage[] {
  const out = [...current];
  for (const m of incoming) {
    const i = out.findIndex((x) => x.id === m.id || (!!m.clientMessageId && x.clientMessageId === m.clientMessageId));
    if (i >= 0) out[i] = { ...m };
    else out.push({ ...m });
  }
  // Optimistic messages stay on top (newest) until the server copy arrives.
  return out.sort((a, b) => (a.local && !b.local ? -1 : !a.local && b.local ? 1 : byNewest(a, b)));
}

async function uploadImage(conversationId: string, file: { uri: string; mimeType: string }): Promise<string> {
  const blob = await (await fetch(file.uri)).blob();
  const mimeType = file.mimeType || blob.type || 'image/jpeg';
  const ticket = await chatApi.requestUpload(conversationId, { kind: 'image', mimeType, byteSize: blob.size });
  await client.upload(ticket.uploadUrl, ticket.method, ticket.headers, blob);
  return ticket.uploadToken;
}

/**
 * Message thread state: keyset pagination (newest first, `before` cursor), optimistic sends with client message ids
 * (retries reuse the id, so the server's idempotency prevents duplicates), realtime updates with a polling fallback,
 * read receipts and the closed-conversation state.
 */
export function useChatThread(conversationId: string, myUserId: string | null, matchId: string | null) {
  const { status: rtStatus, send: rtSend } = useRealtime();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [closed, setClosed] = useState(false);
  const [typing, setTyping] = useState(false);
  const [readUpTo, setReadUpTo] = useState<string | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const lastMarked = useRef<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    chatApi.messages(conversationId).then(
      (page) => {
        if (!live) return;
        setMessages((cur) => mergeMessages(cur.filter((m) => m.local), page.items));
        setCursor(page.nextCursor);
        setStatus('ready');
      },
      (e: unknown) => {
        if (!live) return;
        setError(e);
        setStatus('error');
      },
    );
    return () => {
      live = false;
    };
  }, [conversationId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await chatApi.messages(conversationId, cursor);
      setMessages((cur) => mergeMessages(cur, page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setOlderError(e);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loadingOlder]);

  // Polling fallback: refresh the newest page while the socket is down.
  const live = rtStatus === 'open';
  useEffect(() => {
    if (live || status !== 'ready') return;
    const id = setInterval(() => {
      chatApi.messages(conversationId).then(
        (page) => setMessages((cur) => mergeMessages(cur, page.items)),
        (e: unknown) => isApiError(e, 'NOT_FOUND') && setClosed(true),
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, status, conversationId]);

  useRealtimeEvent('message.new', (d) => {
    const m = d as Message;
    if (m?.conversationId !== conversationId) return;
    setMessages((cur) => mergeMessages(cur, [m]));
    if (m.senderId && m.senderId !== myUserId) {
      setTyping(false);
      rtSend({ type: 'delivered', conversationId, messageId: m.id });
    }
  });
  // Media moderation finished (media appears, or a pending item resolves): the full message DTO replaces ours.
  useRealtimeEvent('message.updated', (d) => {
    const m = d as Message;
    if (m?.conversationId !== conversationId || !m.id) return;
    // Merged (not just replaced): a message held back for review reaches the other members only through this event.
    setMessages((cur) => mergeMessages(cur, [m]));
  });
  // Deleted by its sender, or removed by moderation (other members only get this event, never the reason).
  useRealtimeEvent('message.deleted', (d) => {
    const e = d as { messageId: string; conversationId: string };
    if (e?.conversationId !== conversationId) return;
    setMessages((cur) => cur.map((m) => (m.id === e.messageId ? { ...m, deleted: true, body: null, media: [] } : m)));
  });
  useRealtimeEvent('reaction', (d) => {
    const e = d as { messageId: string; conversationId: string; userId: string; emoji: string; added: boolean };
    if (e?.conversationId !== conversationId) return;
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== e.messageId) return m;
        const rest = m.reactions.filter((r) => !(r.userId === e.userId && r.emoji === e.emoji));
        return { ...m, reactions: e.added ? [...rest, { emoji: e.emoji, userId: e.userId }] : rest };
      }),
    );
  });
  useRealtimeEvent('read', (d) => {
    const e = d as { conversationId: string; userId: string; messageId: string };
    if (e?.conversationId === conversationId && e.userId !== myUserId) setReadUpTo(e.messageId);
  });
  useRealtimeEvent('typing', (d) => {
    const e = d as { conversationId: string; userId: string; isTyping: boolean };
    if (e?.conversationId === conversationId && e.userId !== myUserId) setTyping(e.isTyping);
  });
  useRealtimeEvent('match.ended', (d) => {
    const e = d as Partial<MatchEndedEvent> | null;
    // Block and unmatch are deliberately indistinguishable: `{ matchId, conversationId }` either way.
    if ((!!e?.conversationId && e.conversationId === conversationId) || (!!e?.matchId && e.matchId === matchId)) setClosed(true);
  });

  // Read receipts: mark the newest message from the other person as read.
  const newestIncoming = messages.find((m) => !m.local && m.senderId !== myUserId);
  useEffect(() => {
    if (!newestIncoming || lastMarked.current === newestIncoming.id) return;
    lastMarked.current = newestIncoming.id;
    chatApi.markRead(conversationId, newestIncoming.id).catch(() => {
      lastMarked.current = null;
    });
  }, [newestIncoming, conversationId]);

  const dispatch = useCallback(
    async (clientMessageId: string) => {
      const p = pending.current.get(clientMessageId);
      if (!p) return;
      setMessages((cur) => cur.map((m) => (m.clientMessageId === clientMessageId ? { ...m, local: 'sending', error: undefined } : m)));
      try {
        if (p.file && !p.uploadToken) p.uploadToken = await uploadImage(conversationId, p.file);
        const firstFromMe = !messages.some((m) => !m.local && m.senderId === myUserId);
        const sent = await chatApi.send(conversationId, { clientMessageId, kind: p.kind, body: p.body, uploadToken: p.uploadToken, aiAssisted: p.aiAssisted ?? false });
        pending.current.delete(clientMessageId);
        setMessages((cur) => mergeMessages(cur.filter((m) => m.clientMessageId !== clientMessageId || !m.local), [sent]));
        analytics.track('message_sent', { kind: p.kind, aiAssisted: p.aiAssisted ?? false });
        if (firstFromMe) analytics.track('conversation_started', {});
      } catch (e) {
        if (isApiError(e, 'CONVERSATION_CLOSED')) setClosed(true);
        // An expired upload token means the file must be uploaded again on retry.
        if (isApiError(e, 'UPLOAD_TOKEN_INVALID') || isApiError(e, 'MEDIA_NOT_UPLOADED')) p.uploadToken = undefined;
        setMessages((cur) => cur.map((m) => (m.clientMessageId === clientMessageId ? { ...m, local: 'failed', error: e } : m)));
      }
    },
    [conversationId, messages, myUserId],
  );

  const send = useCallback(
    (p: Pending) => {
      const clientMessageId = Crypto.randomUUID();
      pending.current.set(clientMessageId, p);
      const optimistic: ThreadMessage = {
        id: `local-${clientMessageId}`,
        conversationId,
        senderId: myUserId,
        clientMessageId,
        kind: p.kind,
        body: p.body ?? null,
        gifProviderId: null,
        media: [],
        replyToId: null,
        reactions: [],
        safetyWarning: false,
        aiAssisted: p.aiAssisted ?? false,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
        local: 'sending',
        localUri: p.file?.uri,
      };
      setMessages((cur) => [optimistic, ...cur]);
      void dispatch(clientMessageId);
    },
    [conversationId, dispatch, myUserId],
  );

  const retry = useCallback((clientMessageId: string) => void dispatch(clientMessageId), [dispatch]);
  const discard = useCallback((clientMessageId: string) => {
    pending.current.delete(clientMessageId);
    setMessages((cur) => cur.filter((m) => m.clientMessageId !== clientMessageId || !m.local));
  }, []);

  const toggleReaction = useCallback(
    async (m: Message, emoji: string) => {
      const mine = m.reactions.some((r) => r.userId === myUserId && r.emoji === emoji);
      const apply = (add: boolean) =>
        setMessages((cur) =>
          cur.map((x) => (x.id === m.id ? { ...x, reactions: add ? [...x.reactions.filter((r) => !(r.userId === myUserId && r.emoji === emoji)), { emoji, userId: myUserId ?? '' }] : x.reactions.filter((r) => !(r.userId === myUserId && r.emoji === emoji)) } : x)),
        );
      apply(!mine);
      try {
        if (mine) await chatApi.unreact(m.id, emoji);
        else await chatApi.react(m.id, emoji);
      } catch (e) {
        apply(mine);
        if (isApiError(e, 'CONVERSATION_CLOSED')) setClosed(true);
        throw e;
      }
    },
    [myUserId],
  );

  const remove = useCallback(async (m: Message) => {
    await chatApi.remove(m.id);
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, media: [] } : x)));
  }, []);

  // Only transitions are sent: the server closes sockets that send more than 50 frames per 10 seconds.
  const typingSent = useRef(false);
  const setTypingState = useCallback(
    (isTyping: boolean) => {
      if (typingSent.current === isTyping) return;
      if (rtSend({ type: 'typing', conversationId, isTyping })) typingSent.current = isTyping;
    },
    [conversationId, rtSend],
  );

  return {
    messages, status, error, reload, loadOlder, hasOlder: !!cursor, loadingOlder, olderError,
    closed, setClosed, typing, readUpTo, live, send, retry, discard, toggleReaction, remove, setTyping: setTypingState,
  };
}
