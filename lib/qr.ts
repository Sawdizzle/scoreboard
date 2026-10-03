// A link as a QR code: the side length in modules and one SVG path of the
// dark ones. Drawn as vector, so it stays sharp at any stream size.
import qrcode from 'qrcode-generator';

export function qrPath(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size: n, d };
}
