'use client';

import { useState } from 'react';

// The invite link, and one button that puts it on the clipboard. The link is
// shown too, because a clipboard write can be refused and the organizer still
// needs something to select by hand.
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard: the field below is selectable */ }
  }
  return (
    <div className="copy">
      <input className="input copy-url" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  );
}
