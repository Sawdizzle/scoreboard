import { redirect } from 'next/navigation';

// Staff seats live on People now, with the families and fans.
export default async function Staff({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/t/${(await params).slug}/people`);
}
