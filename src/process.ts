import { sortMultiple } from './data';

const obj = {};

class Queue {
  private queue: Set<Stream> | null = null;
  add(streams: Set<Stream>) {
    const first = !this.queue;
    if (first) this.queue = new Set();
    for (const s of streams) {
      if (s.index) this.queue!.add(s);
    }
    if (first) setTimeout(() => this.next());
  }
  remove(stream: Stream) {
    if (this.queue && this.queue.has(stream)) this.queue.delete(stream);
  }
  next() {
    if (this.queue && this.queue.size > 0) {
      const next = [...this.queue].sort((a, b) =>
        sortMultiple(a.index, b.index, (x, y) => x - y, true),
      )[0];
      this.queue.delete(next);
      next.update();
      this.next();
    } else {
      this.queue = null;
    }
  }
}

export class Stream {
  listeners = new Set<any>();
  index;
  value;
  start;
  update;
  stop;

  constructor(queue: Queue, index, run, onChange) {
    this.index = index;
    this.start = () => {
      let active = new Set<any>();
      const creator = new Creator(queue, index);
      const { initial, update, stop } = run({
        get: s => {
          active.add(s);
          s.observe(this);
          return s.value;
        },
        output: v => {
          this.value = v;
          if (onChange) onChange(v);
          queue.add(this.listeners);
        },
        create: (...args) => (creator.create as any)(...args),
      });
      this.value = initial;
      this.update = () => {
        const prevActive = active;
        active = new Set();
        creator.reset();
        if (update) update();
        for (const s of prevActive) {
          if (!active.has(s)) s.unobserve(this);
        }
      };
      this.stop = () => {
        queue.remove(this);
        for (const s of active.values()) s.unobserve(this);
        active = new Set();
        if (stop) stop();
      };
    };
  }

  observe(x = obj) {
    if (this.listeners.size === 0) this.start();
    this.listeners.add(x);
  }
  unobserve(x = obj) {
    if (this.listeners.has(x)) {
      this.listeners.delete(x);
      if (this.listeners.size === 0) this.stop();
    }
  }
  cancel() {
    if (this.listeners.size > 0) {
      this.listeners = new Set();
      this.stop();
    }
  }
}

class Creator {
  queue;
  base;
  counter = 0;
  constructor(queue, base) {
    this.queue = queue;
    this.base = base;
  }
  create(run, onChange?, forceIndex?) {
    const index = forceIndex || [...this.base, this.counter++];
    return new Stream(this.queue, index, run, onChange) as any;
  }
  reset() {
    this.counter = 0;
  }
}

export default () => {
  const queue = new Queue();
  const result = new Creator(queue, []) as any;
  return (...args) => result.create(...args);
};
