// Shown the moment a team page link is tapped, while the server reads the
// page: a tap that shows nothing for a second reads as a tap that missed.
export default function TeamLoading() {
  return (
    <div className="page loading-pane" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sub">Loading…</span>
    </div>
  );
}
