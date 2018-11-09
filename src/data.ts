export const toData = value => {
  if (!value) return { type: 'nil' };
  if (value === true) return { type: 'value', value: '1' };
  if (typeof value === 'number') return { type: 'value', value: `${value}` };
  if (typeof value === 'string') return { type: 'value', value };
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return { type: 'value', value: value.toISOString() };
  }
  if (
    Object.keys(value).length === 2 &&
    Object.keys(value)
      .sort()
      .join(',') === 'lat,lng'
  ) {
    return { type: 'value', value: JSON.stringify(value) };
  }
  if (Array.isArray(value)) {
    return { type: 'list', value: { indices: value.map(toData), values: {} } };
  }
  const result = { indices: [], values: {} } as any;
  Object.keys(value).forEach((k: any) => {
    const n = !isNaN(k) && !isNaN(parseFloat(k)) && parseFloat(k);
    if (n && Math.floor(n) === n) result.indices[n] = toData(value[k]);
    else result.values[k] = { key: toData(k), value: toData(value[k]) };
  });
  return { type: 'list', value: result };
};

const regexs = {
  time: /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/,
  location: /{"lat":[0-9\.-]+,"lng":[0-9\.-]+}/,
};
export const toTypedValue = ({ type, value }) => {
  if (type !== 'value') return { type, value };
  if (!isNaN(value) && !isNaN(parseFloat(value))) {
    const v = parseFloat(value);
    return { type: Math.floor(v) === v ? 'integer' : 'number', value: v };
  }
  if (regexs.time.test(value)) {
    return { type: 'time', value: new Date(value) };
  }
  if (regexs.location.test(value)) {
    return { type: 'location', value: JSON.parse(value) };
  }
  return { type: 'value', value };
};

const stringToNatural = s =>
  s
    .split(/(\-?\d*\.?\d+)/)
    .filter(x => x)
    .map(x => toTypedValue({ type: 'value', value: x }).value);

const getMinus = v => {
  if (!v) return { minus: false, v };
  const minus = typeof v === 'number' ? v < 0 : v[0] === '-';
  if (!minus) return { minus, value: v };
  return { minus, value: typeof v === 'number' ? -v : v.slice(1) };
};

const sortMultiple = (items1, items2, sortItems) =>
  Array.from({ length: Math.max(items1.length, items2.length) }).reduce(
    (res, _, i) => {
      if (res !== 0) return res;
      if (items1[i] === undefined) return -1;
      if (items2[i] === undefined) return 1;
      return sortItems(items1[i], items2[i]);
    },
    0,
  ) as -1 | 0 | 1;

const sortStrings = (s1, s2) =>
  sortMultiple(stringToNatural(s1), stringToNatural(s2), (n1, n2) => {
    if (n1 === n2) return 0;
    const m1 = getMinus(n1);
    const m2 = getMinus(n2);
    if (m1.minus !== m2.minus) return m1.minus ? -1 : 1;
    const dir = m1.minus ? -1 : 1;
    const t1 = typeof m1.value;
    const t2 = typeof m2.value;
    if (t1 === t2) {
      if (t1 === 'string') return dir * m1.value.localeCompare(m2.value);
      return dir * (m1.value < m2.value ? -1 : 1);
    }
    return dir * (t1 === 'number' ? -1 : 1);
  });

export const compare = (v1, v2) => {
  if (v1.type !== v2.type) {
    return v1.type === 'value' || v2.type === 'list' ? -1 : 1;
  }
  if (v1.type === 'nil') return 0;
  if (v1.type === 'value') return sortStrings(v1.value, v2.value);
  const keys = [
    ...Array.from({
      length: Math.max(v1.value.indices.length, v2.value.indices.length),
    }).map((_, i) => i),
    ...Array.from(
      new Set([
        ...Object.keys(v1.value.values),
        ...Object.keys(v2.value.values),
      ]),
    ).sort((a, b) =>
      compare(
        (v1.value.values[a] || v2.value.values[a]).key,
        (v1.value.values[b] || v2.value.values[b]).key,
      ),
    ),
  ];
  return sortMultiple(
    keys.map(
      k =>
        (typeof k === 'number'
          ? v1.value.indices[k]
          : v1.value.values[k] && v1.value.values[k].value) || { type: 'nil' },
    ),
    keys.map(
      k =>
        (typeof k === 'number'
          ? v2.value.indices[k]
          : v2.value.values[k] && v2.value.values[k].value) || { type: 'nil' },
    ),
    compare,
  );
};

export const toKey = ({ type, value }) => {
  if (type !== 'list') {
    if (!isNaN(value) && !isNaN(parseFloat(value))) {
      const n = parseFloat(value);
      if (Math.floor(n) === n) return n - 1;
    }
    return value || '';
  }
  return JSON.stringify({
    indices: value.indices.map(toKey),
    values: Object.keys(value.values).reduce(
      (res, k) => ({ ...res, [k]: toKey(value.values[k].value) }),
      {},
    ),
  });
};

export const resolve = (stream, get) => {
  const result = get(stream);
  return result.type === 'stream' ? resolve(result.value, get) : result;
};

export const resolveDeep = (value, get) => {
  const result = value.type === 'stream' ? resolve(value.value, get) : value;
  if (result.type !== 'list') return result;
  return {
    ...result,
    value: {
      ...result.value,
      indices: result.value.indices.reduce((res, v, i) => {
        const r = v && resolveDeep(v, get);
        if (r && r.type !== 'nil') res[i] = r;
        return res;
      }, []),
      values: Object.keys(result.value.values).reduce((res, k) => {
        const r = resolveDeep(result.value.values[k].value, get);
        if (r.type !== 'nil' || r.set) {
          res[k] = {
            key: resolveDeep(result.value.values[k].key, get),
            value: r,
          };
        }
        return res;
      }, {}),
    },
  };
};

export const setOther = (list, other, otherType) => ({
  type: 'list',
  value: {
    ...(list.value || { indices: [], values: {} }),
    other,
    otherType,
  },
});

export const listGet = ({ type, value }, key, withOther = true) => {
  if (type !== 'list') return { type: 'nil' };
  const k = toKey(key);
  const v =
    typeof k === 'number'
      ? value.indices[k]
      : value.values[k] && value.values[k].value;
  return v || (withOther && value.other) || { type: 'nil' };
};

export const listOrNull = list => {
  if (
    list.indices.length + Object.keys(list.values).length === 0 &&
    !list.other
  ) {
    return { type: 'nil' };
  }
  return { type: 'list', value: list };
};
