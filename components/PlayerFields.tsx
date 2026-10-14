import { POSITIONS, type Player } from '@/lib/types';

// Number, name, how they bat and throw, where they play. Shared by Add player
// and the Player screen; `p` is absent when adding.
export function PlayerFields({ p }: { p?: Player }) {
  return (
    <>
      <div className="field-row num-first">
        <label className="field"><span>No.</span>
          <input className="input" name="number" defaultValue={p?.number} inputMode="numeric" pattern="[0-9]{0,3}" maxLength={3} autoComplete="off" />
        </label>
        <label className="field"><span>First name</span>
          <input className="input" name="first_name" defaultValue={p?.first_name} maxLength={40} autoComplete="off" />
        </label>
        <label className="field"><span>Last name</span>
          <input className="input" name="last_name" defaultValue={p?.last_name} maxLength={40} autoComplete="off" />
        </label>
      </div>
      <fieldset>
        <legend className="legend">Positions</legend>
        <div className="pills">
          {POSITIONS.map((pos) => (
            <label key={pos} className="pill">
              <input type="checkbox" name="positions" value={pos} defaultChecked={p?.positions.includes(pos)} />
              <span>{pos}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field-row bt">
        <fieldset>
          <legend className="legend">Bats</legend>
          <div className="pills">
            {(['R', 'L', 'S'] as const).map((v) => (
              <label key={v} className="pill">
                <input type="radio" name="bats" value={v} defaultChecked={p?.bats === v} />
                <span title={v === 'S' ? 'Switch hitter' : undefined}>{v}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="legend">Throws</legend>
          <div className="pills">
            {(['R', 'L'] as const).map((v) => (
              <label key={v} className="pill">
                <input type="radio" name="throws" value={v} defaultChecked={p?.throws === v} />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </>
  );
}
