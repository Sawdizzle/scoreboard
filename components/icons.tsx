// Stroke icons, drawn at the size they are used. `currentColor`, so each takes
// the color of the text around it.
type P = { size?: number };
const svg = (size: number, d: string, width = 2.6) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const ChevronRight = ({ size = 16 }: P) => svg(size, 'M9 6l6 6-6 6');
export const ChevronLeft = ({ size = 22 }: P) => svg(size, 'M15 6l-6 6 6 6');
export const ChevronDown = ({ size = 16 }: P) => svg(size, 'M6 9l6 6 6-6', 2.4);
export const Plus = ({ size = 16 }: P) => svg(size, 'M12 5v14M5 12h14', 2.8);
export const Check = ({ size = 13 }: P) => svg(size, 'M5 12.5l4.5 4.5L19 7.5', 3.2);
export const Cross = ({ size = 16 }: P) => svg(size, 'M6 6l12 12M18 6L6 18');
