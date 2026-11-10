export class Emitter {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return this;
  }
  emit(type, data) {
    const list = this.map.get(type);
    if (list) for (const fn of list) fn(data);
  }
}
