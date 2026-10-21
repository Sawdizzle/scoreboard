// A small obs-websocket 5 client, for what window.obsstudio cannot do: mute
// an audio input. OBS runs the server itself (Tools → WebSocket Server
// Settings, port 4455). The password never leaves this page: it rides in the
// Browser Source URL's #fragment, which the browser does not send anywhere.
// https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

export type ObsWs = { call: <T = Record<string, unknown>>(type: string, data?: Record<string, unknown>) => Promise<T>; close: () => void; closed: Promise<void> };
export class ObsWsError extends Error {
  constructor(public code: 'auth' | 'refused' | 'request', message: string) { super(message); }
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const sha = async (s: string) => b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export function obsConnect(password: string, url = 'ws://127.0.0.1:4455'): Promise<ObsWs> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { reject(new ObsWsError('refused', 'No obs-websocket here')); return; }
    const waiting = new Map<string, { ok: (v: never) => void; no: (e: Error) => void }>();
    let ready = false, n = 0, ended: () => void = () => {};
    const closed = new Promise<void>((r) => { ended = r; });
    const api: ObsWs = {
      call: (requestType, requestData = {}) => new Promise((ok, no) => {
        if (ws.readyState !== WebSocket.OPEN) { no(new ObsWsError('refused', 'Not connected')); return; }
        const requestId = String(++n);
        waiting.set(requestId, { ok: ok as (v: never) => void, no });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
        window.setTimeout(() => { if (waiting.delete(requestId)) no(new ObsWsError('request', `${requestType} timed out`)); }, 5000);
      }),
      close: () => ws.close(),
      closed,
    };
    const timer = window.setTimeout(() => { if (!ready) { ws.close(); reject(new ObsWsError('refused', 'obs-websocket did not answer')); } }, 6000);
    ws.onmessage = async (e) => {
      let m: { op: number; d: Record<string, unknown> };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.op === 0) {
        // Hello: answer with Identify, proving the password when OBS asks for one.
        const a = m.d.authentication as { challenge: string; salt: string } | undefined;
        const d: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 };
        if (a) d.authentication = await sha((await sha(password + a.salt)) + a.challenge);
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (m.op === 2) {
        ready = true; window.clearTimeout(timer); resolve(api);
      } else if (m.op === 7) {
        const w = waiting.get(String(m.d.requestId));
        if (!w) return;
        waiting.delete(String(m.d.requestId));
        const st = m.d.requestStatus as { result: boolean; comment?: string };
        if (st?.result) w.ok((m.d.responseData ?? {}) as never); else w.no(new ObsWsError('request', st?.comment || 'OBS said no'));
      }
    };
    ws.onclose = (e) => {
      window.clearTimeout(timer);
      for (const w of waiting.values()) w.no(new ObsWsError('refused', 'Connection closed'));
      waiting.clear();
      ended();
      // 4009: AuthenticationFailed.
      if (!ready) reject(new ObsWsError(e.code === 4009 ? 'auth' : 'refused', e.code === 4009 ? 'Wrong obs-websocket password' : 'No obs-websocket here'));
    };
  });
}

// The input kinds that carry a microphone or a camera's own audio, on every
// platform OBS runs on. Desktop audio and media files are never muted.
export const MIC_KINDS = new Set([
  'coreaudio_input_capture', 'av_capture_input', 'macos-avcapture', 'macos-avcapture-fast',
  'wasapi_input_capture', 'dshow_input', 'pulse_input_capture', 'alsa_input_capture', 'jack_input_client', 'v4l2_input',
]);
