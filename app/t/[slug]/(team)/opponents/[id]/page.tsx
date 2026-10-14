import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from '@/components/icons';
import { OpponentEditor } from '@/components/OpponentEditor';
import { listOpponents, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Opponent' };

export default async function Opponent({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { supabase, team } = await loadTeam(slug);
  const opponent = (await listOpponents(supabase, team.id)).find((o) => o.id === id);
  if (!opponent) notFound();
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${slug}/opponents`} aria-label="Back to opponents" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <h1 className="disp h1">{opponent.name}</h1>
      </div>
      <OpponentEditor slug={slug} opponent={opponent} />
    </div>
  );
}
