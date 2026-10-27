'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { postMessage, removeMessage } from '@/app/hub-actions';
import { browserClient } from '@/lib/supabase/browser';
import { CHANNEL_LABEL, type Channel, type Message } from '@/lib/types';

// The tick that tells other open screens to read again. It carries nothing:
// what they read comes back through the database's own rules.
export const chatTopic = (teamId: string) => `team-chat-${teamId}`;

const stamp = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// One channel of a team's messages. New ones arrive live while the screen is
// open (and every 30 seconds regardless, in case a tick is missed); a message
// sent here is pushed to the phones of everyone else in the channel.
export function ChatView({ slug, teamId, me, channel, channels, initial, canPost, moderate, league = [] }: {
  slug: string; teamId: string; me: string; channel: Channel; channels: Channel[]; initial: Message[];
  canPost: boolean; moderate: boolean; league?: { id: number; body: string; created_at: string; author: string }[];
}) {
  const [msgs, setMsgs] = useState(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, start] = useTransition();
  const wire = useRef<ReturnType<ReturnType<typeof browserClient>['channel']> | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await browserClient().from('team_messages').select('id, channel, user_id, body, created_at, profiles(display_name)')
      .eq('team_id', teamId).eq('channel', channel).order('id', { ascending: false }).limit(60);
    if (!data) return;
    setMsgs((data as unknown as (Message & { profiles: { display_name: string } | null })[])
      .map(({ profiles, ...m }) => ({ ...m, author: profiles?.display_name ?? 'Former member' })).reverse());
  }, [teamId, channel]);

  useEffect(() => {
    const sb = browserClient();
    const c = sb.channel(chatTopic(teamId)).on('broadcast', { event: 'msg' }, (m: { payload?: { channel?: string } }) => {
      if (m.payload?.channel === channel) void load();
    }).subscribe();
    wire.current = c;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => { clearInterval(t); void sb.removeChannel(c); };
  }, [teamId, channel, load]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = () => start(async () => {
    const r = await postMessage(slug, channel, text);
    if (r.error) { setError(r.error); return; }
    setError(''); setText('');
    await load();
    void wire.current?.send({ type: 'broadcast', event: 'msg', payload: { channel } });
  });
  const remove = (id: number) => start(async () => {
    const r = await removeMessage(slug, id);
    if (r.error) { setError(r.error); return; }
    setMsgs((m) => m.filter((x) => x.id !== id));
    void wire.current?.send({ type: 'broadcast', event: 'msg', payload: { channel } });
  });

  return (
    <div className="chat">
      <nav className="seg" aria-label="Channels">
        {channels.map((c) => (
          <Link key={c} href={`/t/${slug}/chat?c=${c}`} className="seg-item" aria-current={c === channel ? 'page' : undefined}>{CHANNEL_LABEL[c]}</Link>
        ))}
      </nav>
      <p className="hint">
        {channel === 'announcements' && 'From the coaches and the league, to every family. Coaches post here.'}
        {channel === 'families' && 'Parents and staff. Coaches can see and remove any message. Players are not in the chat.'}
        {channel === 'staff' && 'Staff only: coaches, scorers and media.'}
      </p>
      <div className="chat-log" aria-live="polite">
        {channel === 'announcements' && league.map((l) => (
          <div key={`l${l.id}`} className="msg notice">
            <span className="msg-meta"><b>League</b> · {l.author} · {stamp(l.created_at)}</span>
            <div className="msg-body">{l.body}</div>
          </div>
        ))}
        {msgs.length === 0 && league.length === 0 && <div className="card empty"><b>No messages yet</b>{canPost ? 'Say hello.' : 'Announcements from the coaches show up here.'}</div>}
        {msgs.map((m) => {
          const mine = m.user_id === me;
          return (
            <div key={m.id} className={`msg${mine ? ' mine' : ''}${channel === 'announcements' ? ' notice' : ''}`}>
              <span className="msg-meta">
                {!mine && <b>{m.author}</b>}<span suppressHydrationWarning>{stamp(m.created_at)}</span>
                {(mine || moderate) && <button type="button" className="link" disabled={busy} onClick={() => remove(m.id)}>Remove</button>}
              </span>
              <div className="msg-body">{m.body}</div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {canPost && (
        <form className="chat-send" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(); }}>
          <textarea className="input textarea" value={text} maxLength={2000} rows={1} aria-label="Message"
            placeholder={channel === 'announcements' ? 'Announcement to every family' : 'Message'}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); if (text.trim()) send(); } }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      )}
    </div>
  );
}
