import type { Metadata } from 'next';
import { OverlayDemo } from '@/components/overlay/OverlayDemo';

export const metadata: Metadata = { title: 'Stream preview', robots: { index: false, follow: false } };

// The preview frame on the Stream screen. It reads nothing: its contents are
// posted to it by that screen.
export default function OverlayDemoPage() {
  return <OverlayDemo />;
}
