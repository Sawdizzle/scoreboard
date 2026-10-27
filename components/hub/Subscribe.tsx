'use client';

import { useState, useTransition } from 'react';
import { calendarToken } from '@/app/hub-actions';
import { CopyLink } from '@/components/CopyLink';

// The team's calendar in the phone's own calendar app. The link is private to
// the person who made it: a new one retires the old, if it was shared.
export function Subscribe({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const get = (renew = false) => start(async () => setToken(await calendarToken(slug, renew)));
  if (!token) {
    return (
      <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => get()}>
        {busy ? 'Making your link…' : 'Add to my calendar'}
      </button>
    );
  }
  const https = `${location.origin}/cal/${token}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return (
    <div className="card pad">
      <div className="row-main">
        <span className="row-title">Subscribe to the team calendar</span>
        <span className="row-meta">Games, practices and changes appear in your calendar app and stay up to date. Google can take several hours to show a change; notifications tell you right away.</span>
      </div>
      <div className="btn-row">
        <a className="btn btn-primary" href={webcal}>iPhone, Mac or Outlook</a>
        <a className="btn btn-quiet" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">Google Calendar</a>
      </div>
      <CopyLink url={https} label="Calendar link" />
      <button type="button" className="link" disabled={busy} onClick={() => get(true)}>Make a new link (the old one stops working)</button>
    </div>
  );
}
