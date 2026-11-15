// The pad opening: something on screen at once, while the game loads.
export default function PadLoading() {
  return (
    <main className="shell">
      <div className="page loading-pane" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="sub">Opening the pad…</span>
      </div>
    </main>
  );
}
