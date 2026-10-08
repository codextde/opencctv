export const F = {
  HELLO: 1,
  REQ: 2,
  REQ_DATA: 3,
  REQ_END: 4,
  RES: 5,
  RES_DATA: 6,
  RES_END: 7,
  CANCEL: 8,
  CREDIT: 9,
  WS_OPEN: 10,
  WS_ACCEPT: 11,
  WS_TEXT: 12,
  WS_BINARY: 13,
  WS_CLOSE: 14,
  PING: 15,
  PONG: 16,
  ERROR: 17,
} as const;

export type FrameType = (typeof F)[keyof typeof F];

export type Frame = { type: FrameType; stream: number; payload: Uint8Array };

export const HEADER_SIZE = 5;
export const MAX_CHUNK = 64 * 1024;
export const WINDOW = 512 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(type: FrameType, stream: number, payload?: Uint8Array | string | object): Uint8Array {
  let body: Uint8Array;
  if (payload === undefined) body = new Uint8Array(0);
  else if (payload instanceof Uint8Array) body = payload;
  else if (typeof payload === "string") body = enc.encode(payload);
  else body = enc.encode(JSON.stringify(payload));
  const out = new Uint8Array(HEADER_SIZE + body.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, stream >>> 0, false);
  out.set(body, HEADER_SIZE);
  return out;
}

export function decodeFrame(data: ArrayBuffer | Uint8Array | Buffer): Frame {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < HEADER_SIZE) throw new Error("short frame");
  const type = u8[0] as FrameType;
  if (type < 1 || type > 17) throw new Error(`unknown frame type ${type}`);
  const stream = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(1, false);
  return { type, stream, payload: u8.subarray(HEADER_SIZE) };
}

export function frameJson<T>(f: Frame): T {
  return JSON.parse(dec.decode(f.payload)) as T;
}

export function frameText(f: Frame): string {
  return dec.decode(f.payload);
}

export function encodeCredit(stream: number, bytes: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, bytes >>> 0, false);
  return encodeFrame(F.CREDIT, stream, b);
}

export function decodeCredit(f: Frame): number {
  return new DataView(f.payload.buffer, f.payload.byteOffset, f.payload.byteLength).getUint32(0, false);
}

export function* chunks(data: Uint8Array, size = MAX_CHUNK): Generator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, Math.min(data.length, i + size));
}

export type ReqHead = { method: string; path: string; headers: [string, string][]; role?: string; user?: string; base?: string };
export type ResHead = { status: number; headers: [string, string][] };
export type WsOpen = { path: string; headers: [string, string][]; protocols?: string[]; role?: string; user?: string; base?: string };

export class CreditGate {
  private credit: number;
  private waiters: (() => void)[] = [];
  closed = false;

  constructor(initial = WINDOW) {
    this.credit = initial;
  }

  add(n: number) {
    this.credit += n;
    this.wake();
  }

  close() {
    this.closed = true;
    this.wake();
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  async take(n: number): Promise<boolean> {
    while (!this.closed && this.credit < n) await new Promise<void>((r) => this.waiters.push(r));
    if (this.closed) return false;
    this.credit -= n;
    return true;
  }

  get available(): number {
    return this.credit;
  }
}

export function creditedStream(onCredit: (bytes: number) => void, onCancel: () => void) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let enqueued = 0;
  let credited = 0;
  let done = false;
  const grant = () => {
    if (done) return;
    const queued = Math.max(0, WINDOW - (controller.desiredSize ?? 0));
    const delivered = enqueued - queued;
    const n = delivered - credited;
    if (n > 0) {
      credited += n;
      onCredit(n);
    }
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      pull() {
        grant();
      },
      cancel() {
        done = true;
        onCancel();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: WINDOW }),
  );
  return {
    stream,
    push(chunk: Uint8Array) {
      if (done) return;
      enqueued += chunk.length;
      try {
        controller.enqueue(chunk.slice());
      } catch {}
      grant();
    },
    end() {
      if (done) return;
      done = true;
      try {
        controller.close();
      } catch {}
    },
    error(e: Error) {
      if (done) return;
      done = true;
      try {
        controller.error(e);
      } catch {}
    },
  };
}
