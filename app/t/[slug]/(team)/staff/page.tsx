import { redirect } from 'next/navigation';

// One person runs Scoreboard for their own team: there are no staff seats to
// hand out. The old address goes to the teams you play.
export default async function Staff({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/t/${(await params).slug}/opponents`);
}
