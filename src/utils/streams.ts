import { sortMultiple } from './misc';

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
  value = null;
  start;
  update;
  stop;
  onChange;

  constructor(queue: Queue, index, run) {
    this.index = index;
    this.start = () => {
      let active = new Set<any>();
      const creator = new Creator(queue, index);
      let firstUpdate = true;
      const update = run(
        (v) => {
          this.value = v;
          if (!firstUpdate) {
            if (this.onChange) this.onChange(v);
            queue.add(this.listeners);
          }
        },
        (s, snapshot) => {
          active.add(s);
          s.observe(this);
          if (snapshot) s.unobserve(this);
          return s.value;
        },
        (...args) => (creator.create as any)(...args),
      );
      if (update) update();
      firstUpdate = false;
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
        if (update && update.length === 1) update(true);
      };
    };
  }

  observe(x?) {
    if (typeof x === 'function') this.onChange = x;
    if (this.listeners.size === 0) this.start();
    this.listeners.add(typeof x === 'function' ? obj : x);
  }
  unobserve(x = obj) {
    delete this.onChange;
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
  create(run, zeroIndex = false) {
    const index = zeroIndex ? [0] : [...this.base, this.counter++];
    return new Stream(this.queue, index, run) as any;
  }
  reset() {
    this.counter = 0;
  }
}

class StaticStream {
  run;
  value = null;
  hasRun = false;
  constructor(run) {
    this.run = run;
  }
  get() {
    if (this.hasRun) return this.value;
    const update = this.run(
      (v) => {
        this.value = v;
      },
      (s) => s.get(),
      (run) => new StaticStream(run),
    );
    if (update) {
      update();
      if (update.length === 1) update(true);
    }
    this.hasRun = true;
    return this.value;
  }
}

export default (build, output?) => {
  if (!output) {
    return build((run) => new StaticStream(run)).get();
  }
  const queue = new Queue();
  const creator = new Creator(queue, []) as any;
  const stream = build((...args) => creator.create(...args));
  stream.observe(output);
  const first = stream.value;
  if (!output) {
    stream.unobserve();
    return first;
  }
  output(first);
  return () => stream.unobserve();
};