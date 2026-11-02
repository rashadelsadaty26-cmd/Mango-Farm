// In-memory Firestore: documents by path, onSnapshot, setDoc(merge) / updateDoc with dotted paths + deleteField.
// Every write is appended to window.__fsWrites so tests can assert exactly what was (not) sent.
const w = window as any;
w.__fsDocs = w.__fsDocs || {};
w.__fsWrites = w.__fsWrites || [];
const listeners: Record<string, Array<(s: any) => void>> = {};
const DEL = { __deleteField: true };
const snap = (path: string) => ({ exists: () => path in w.__fsDocs, data: () => JSON.parse(JSON.stringify(w.__fsDocs[path] ?? {})), metadata: { fromCache: false, hasPendingWrites: false } });
const notify = (path: string) => (listeners[path] || []).forEach((cb) => setTimeout(() => cb(snap(path)), 0));
w.__fsNotify = notify;
export const initializeFirestore = () => ({ stub: true });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const doc = (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') });
export const deleteField = () => DEL;
const setPath = (obj: any, path: string, value: any) => {
  const parts = path.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] ?? {}; o = o[parts[i]]; }
  if (value && value.__deleteField) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
};
const clean = (v: any): any => { if (v === undefined) throw new Error('Firestore: undefined value in write'); if (v && typeof v === 'object' && !v.__deleteField) for (const k of Object.keys(v)) clean(v[k]); return v; };
export const setDoc = async (ref: any, data: any, opts?: any) => {
  clean(data);
  w.__fsWrites.push({ op: 'setDoc', path: ref.path, keys: Object.keys(data), data: JSON.parse(JSON.stringify(data)), merge: !!opts?.merge });
  const cur = w.__fsDocs[ref.path] ?? {};
  w.__fsDocs[ref.path] = opts?.merge ? deepMerge(cur, data) : JSON.parse(JSON.stringify(data));
  notify(ref.path);
};
const deepMerge = (a: any, b: any): any => { const out = { ...a }; for (const k of Object.keys(b)) { out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !b[k].__deleteField ? deepMerge(a[k], b[k]) : JSON.parse(JSON.stringify(b[k])); } return out; };
export const updateDoc = async (ref: any, updates: any) => {
  clean(updates);
  w.__fsWrites.push({ op: 'updateDoc', path: ref.path, keys: Object.keys(updates), updates: JSON.parse(JSON.stringify(updates)) });
  const cur = w.__fsDocs[ref.path] ?? {};
  for (const [k, v] of Object.entries(updates)) setPath(cur, k, v);
  w.__fsDocs[ref.path] = cur;
  notify(ref.path);
};
export const onSnapshot = (ref: any, _o: any, cb: (s: any) => void) => {
  (listeners[ref.path] = listeners[ref.path] || []).push(cb);
  setTimeout(() => cb(snap(ref.path)), 0);
  return () => { listeners[ref.path] = (listeners[ref.path] || []).filter((l) => l !== cb); };
};
export type Firestore = any;
