'use client';

import { useState } from 'react';

// A link (an invite, the stream's Browser Source), and one button that puts it on the clipboard. The link is
// shown too, because a clipboard write can be refused and its owner still
// needs something to select by hand.
export function CopyLink({ url, label = 'Invite link' }: { url: string; label?: string }) {
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
      <input className="input copy-url" readOnly value={url} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  );
}
