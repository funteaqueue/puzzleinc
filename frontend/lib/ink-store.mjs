import { validEvent, MAX_POINTS, MAX_STROKES } from './protocol.mjs';

export class InkStore {
  strokes = new Map();
  apply(event, now) {
    if (!validEvent(event)) return;
    if (event.type === 'clear') { this.strokes.clear(); return; }
    if (event.type === 'remove') { this.strokes.delete(event.id); return; }
    if (event.type === 'clear-author') {
      for (const id of this.strokes.keys()) if (id.startsWith(event.author + '-')) this.strokes.delete(id);
      return;
    }
    if (event.type === 'start') {
      if (this.strokes.has(event.id)) return;
      while (this.strokes.size >= MAX_STROKES) this.strokes.delete(this.strokes.keys().next().value);
      this.strokes.set(event.id, { ...event, points: event.points.slice(), updated: now, ended: null });
    } else {
      const stroke = this.strokes.get(event.id);
      if (!stroke || stroke.ended !== null) return;
      stroke.updated = now;
      if (event.type === 'points') stroke.points.push(...event.points.slice(0, MAX_POINTS - stroke.points.length));
      if (event.type === 'end') stroke.ended = now;
    }
    // Bound total drawing work, including persistent marks from an untrusted peer.
    let total = 0;
    for (const s of this.strokes.values()) total += s.points.length;
    while (total > 65536 && this.strokes.size > 1) {
      const first = this.strokes.keys().next().value;
      total -= this.strokes.get(first).points.length;
      this.strokes.delete(first);
    }
  }
  visible(now) {
    for (const [id, s] of this.strokes) {
      if ((s.ended === null && now - s.updated > 15000) || (s.ended !== null && s.ttl && now - s.ended >= s.ttl)) this.strokes.delete(id);
    }
    return this.strokes.values();
  }
}
