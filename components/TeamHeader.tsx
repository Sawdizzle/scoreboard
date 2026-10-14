import Link from 'next/link';
import { ChevronDown } from '@/components/icons';
import { TeamMark, brandOf } from '@/components/TeamBrand';
import { ROLE_LABEL, type Role, type Season, type Team } from '@/lib/types';

export function TeamHeader({ team, role, season }: { team: Team; role: Role; season?: Season }) {
  return (
    <header className="team-head">
      <Link href="/t" className="team-id" aria-label={`${team.name}. Switch team`}>
        <TeamMark brand={brandOf(team)} size={48} />
        <span className="row-main">
          <span className="team-name"><span>{team.display_name}{team.age_group ? ` ${team.age_group}` : ''}</span><ChevronDown /></span>
          <span className="eyebrow">{season ? season.name : 'No season yet'} · {ROLE_LABEL[role]}</span>
        </span>
      </Link>
    </header>
  );
}
