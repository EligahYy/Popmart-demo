import type { SharedSnapshot, SharedState } from '@my-popmart/contracts';
import type { SharedStore, MediaPart } from '../store.js';

export class MemoryStore implements SharedStore {
  state: SharedState | null = null;
  media = new Map<string, MediaPart>();
  async read() { return structuredClone(this.state); }
  async initialize(snapshot: SharedSnapshot) { this.state ??= { revision: 1, snapshot: structuredClone(snapshot) }; }
  async compareAndSwap(revision: number, snapshot: SharedSnapshot) {
    if (this.state?.revision !== revision) return null;
    this.state = { revision: revision + 1, snapshot: structuredClone(snapshot) };
    return this.read();
  }
  async putMedia(part: MediaPart) { if (!this.media.has(`${part.id}:${part.part}`)) this.media.set(`${part.id}:${part.part}`, structuredClone(part)); }
  async readMedia(id: string) { return [...this.media.values()].filter((item) => item.id === id).sort((a, b) => a.part - b.part); }
  async readMediaPart(id: string, part: number) { return this.media.get(`${id}:${part}`); }
}

