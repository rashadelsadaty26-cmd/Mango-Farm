// In-memory Firebase Auth. window.__signIn(uid) / __signOut() drive onAuthStateChanged.
const w = window as any;
w.__authListeners = w.__authListeners || [];
w.__authUser = w.__authUser === undefined ? { uid: 'u1', displayName: 'rashad', email: 'rashad@x' } : w.__authUser;
w.__signInCalls = 0; w.__signOutCalls = 0;
w.__signIn = (uid: string | null) => { w.__authUser = uid ? { uid, displayName: uid, email: uid + '@x' } : null; w.__authListeners.forEach((l: any) => l(w.__authUser)); };
export const getAuth = () => ({ get currentUser() { return w.__authUser; } });
export const onAuthStateChanged = (_a: unknown, cb: (u: unknown) => void) => { w.__authListeners.push(cb); setTimeout(() => cb(w.__authUser), 0); return () => { w.__authListeners = w.__authListeners.filter((l: any) => l !== cb); }; };
export const signOut = async () => { w.__signOutCalls++; w.__signIn(null); };
export const signInWithEmailAndPassword = async () => { w.__signInCalls++; };
export const createUserWithEmailAndPassword = async () => ({});
export const updateProfile = async () => {};
export const setPersistence = async () => {};
export const browserLocalPersistence = {};
export type Auth = any; export type User = any;
