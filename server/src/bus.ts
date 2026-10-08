export type BusMessage =
  | { type: "camera"; camera: unknown }
  | { type: "motion"; event: unknown }
  | { type: "recording"; recording: unknown }
  | { type: "storage"; target: unknown }
  | { type: "site"; site: unknown };

type Listener = (msg: BusMessage) => void;

export class Bus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(msg: BusMessage): void {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch {}
    }
  }
}
