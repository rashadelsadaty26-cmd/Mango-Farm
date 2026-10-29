import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Save, X, Info, AlertTriangle, Bug,
  Droplet, Leaf, LayoutGrid, MousePointer2, Waves, Route, Cloud, HardDrive, Plus, Trash2, Hash,
  WifiOff, RefreshCw, CheckCircle2, AlertCircle, LogIn, LogOut, UserRound, LockKeyhole, Eye, EyeOff,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged, setPersistence, browserLocalPersistence, signOut, type Auth, type User,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  updateDoc,
  deleteField,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { MapCell } from './farm/MapCell';
import { buildCoordinateMap, parseCellId } from './farm/coordinates';
import { InfrastructureLayer } from './farm/InfrastructureLayer';
import { EditGridOverlay } from './farm/EditGridOverlay';
import { TreeSymbols } from './farm/TreeGraphics';
import { GRID, buildKindGrid, kindAt, type KindGrid } from './farm/infrastructure';
import {
  ORIENTATION_OPTIONS, displayOrder, flipsColumns, flipsRows, getGridOrigin, mirrorKindGrid, mirrorSlot,
  normalizeOrientation, type MapOrientation,
} from './farm/orientation';
import { clampView, computeFitView } from './farm/viewport';
import {
  STATUS_GRAFTED, STATUS_NEEDS_PRUNING, STATUS_UPROOTED, TONE_COLORS, VARIETY_ACCENTS, statusLabel,
} from './farm/treeVisuals';
import { LandmarkLayer } from './farm/LandmarkLayer';
import { RealisticLayer } from './farm/realistic/RealisticLayer';
import { RealisticConfirmDialog, RealisticOverlays, RealisticToolbarButtons } from './farm/realistic/RealisticControls';
import { useRealisticMode } from './farm/realistic/useRealisticMode';
import {
  DeleteLandmarkConfirm, LandmarkDetailsDialog, LandmarkPalette, PlacementBar, type PlacedItem,
} from './farm/LandmarkDialog';
import {
  SLOT_BLOCK_MESSAGES, buildLandmarkInventory, createLandmarkType, deleteLandmark as removeLandmark, describeSlot,
  landmarkTypeKey, moveLandmark, normalizeLandmarkTypes, normalizeLandmarks, pickSlotAtPixel, placeLandmark,
  slotBlockedReason, updateLandmark,
  type LandmarkMap, type LandmarkTypeMap,
} from './farm/landmarks';

// ============================================================================
// Firebase is the source of truth whenever it is configured. Firestore's native
// IndexedDB persistent cache is the offline database; localStorage remains only
// as the existing fallback for environments where Firebase is intentionally not
// configured.
// ============================================================================
const STORAGE_KEY = 'mango_farm_grid_state_v1';
// Keep the existing Firestore document structure/path stable.
// Environment variables can override these public Web SDK settings in deployments,
// but the app is connected out-of-the-box to the Firebase project supplied for
// this application.
const APP_ID = (import.meta.env.VITE_APP_ID as string) || 'mango-farm-app';

function getFarmDocumentRef(firestore: Firestore, uid: string) {
  return doc(firestore, 'artifacts', APP_ID, 'users', uid, 'farm_data', 'gridState');
}

function getLocalStorageKey(uid?: string | null): string {
  return uid && uid !== 'local-user' ? `${STORAGE_KEY}_${uid}` : STORAGE_KEY;
}

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) ?? 'AIzaSyB4VoL2HkQNRlKDFOH9C4A9v4LGIToN8vs',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ?? 'mango-farm-4b1a6.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? 'mango-farm-4b1a6',
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ?? 'mango-farm-4b1a6.firebasestorage.app',
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ?? '223435623598',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) ?? '1:223435623598:web:108fe63dbb32620091313f',
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined) ?? 'G-NN2QTNW3ME',
};

const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// The UI intentionally asks for a username instead of exposing an email field.
// Firebase Email/Password Auth remains the underlying credential provider, so the
// username is deterministically mapped to a private synthetic email address.
// Users and passwords are managed in Firebase Authentication; no service-account
// credentials are stored in the browser.
const AUTH_USERNAME_DOMAIN = 'mango-farm-4b1a6.firebaseapp.com';

function usernameToAuthEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${AUTH_USERNAME_DOMAIN}`;
}

function authErrorMessage(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'اسم المستخدم أو كلمة المرور غير صحيحة.';
    case 'auth/too-many-requests':
      return 'تم إيقاف المحاولات مؤقتاً. حاول مرة أخرى لاحقاً.';
    case 'auth/network-request-failed':
      return 'تعذر الاتصال بالإنترنت. إذا سبق تسجيل الدخول على هذا الجهاز، أعد المحاولة عند توفر الاتصال.';
    case 'auth/invalid-email':
      return 'اسم المستخدم غير صالح.';
    case 'auth/email-already-in-use':
      return 'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.';
    case 'auth/weak-password':
      return 'كلمة المرور ضعيفة. استخدم 6 أحرف أو أرقام على الأقل.';
    case 'auth/operation-not-allowed':
      return 'تسجيل الدخول بكلمة المرور غير مفعّل في Firebase Authentication.';
    default:
      return 'تعذر تسجيل الدخول. تحقق من بيانات الدخول وحاول مرة أخرى.';
  }
}

let auth: Auth | undefined;
let db: Firestore | undefined;
if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
}

const DEFAULT_ROWS = 30;
const DEFAULT_COLS = 60;

// 28 حرف عربي أساسي لتوليد أسماء الصفوف (أ..ي)، ثم بعد الحرف الثامن والعشرين
// يبدأ التركيب (أأ، أب، أت...) بنفس فكرة ترقيم أعمدة Excel (A..Z, AA, AB...)
// حتى يدعم التطبيق إضافة عدد غير محدود من الصفوف مستقبلاً.
const ARABIC_BASE_LETTERS = [
  'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر',
  'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف',
  'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي',
];

function getRowLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    n -= 1;
    const rem = n % ARABIC_BASE_LETTERS.length;
    label = ARABIC_BASE_LETTERS[rem] + label;
    n = Math.floor(n / ARABIC_BASE_LETTERS.length);
  }
  return label;
}

const MANGO_VARIETIES = ['غير محدد', 'عويس', 'فونس', 'كيت', 'نعومي', 'زبدية', 'تيمور', 'جحراوي', 'أخرى'];
// Stored values. 'تحتاج تقليم' is displayed as «ضعيفة» (see statusLabel) but is
// stored exactly as before. Grafted / uprooted are two more values of the same
// `status` field and are both drawn black.
const TREE_STATUS = ['سليمة', STATUS_NEEDS_PRUNING, 'مصابة بآفة/مرض', STATUS_GRAFTED, STATUS_UPROOTED];
const DISEASES = ['لا يوجد', 'عفن هبابي', 'ذبابة الفاكهة', 'تشوه زهري', 'أخرى'];

type CellType = 'tree' | 'water_canal' | 'drainage' | 'road' | 'spray_tank';
type GapKind = 'road' | 'drainage' | 'gap';

interface CellData {
  type?: CellType;
  variety?: string;
  status?: string;
  disease?: string;
  pruneDate?: string;
  notes?: string;
  lastUpdated?: string;
}

type CellsData = Record<string, CellData>;

const CELL_TYPE_OPTIONS: { type: CellType; emoji: string; label: string }[] = [
  { type: 'tree', emoji: '🌳', label: 'شجرة' },
  { type: 'water_canal', emoji: '💧', label: 'مروى' },
  { type: 'drainage', emoji: '🕳️', label: 'مصرف' },
  { type: 'road', emoji: '🛣️', label: 'طريق' },
  { type: 'spray_tank', emoji: '🛢️', label: 'حوض رش' },
];

// ---- Mobile header auto-hide -------------------------------------------------
// Phones (narrow viewport, or a touch device in landscape). Desktop never matches.
const MOBILE_LAYOUT_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)';
// Vertical finger travel needed before the header reacts; prevents flicker from
// tiny movements while panning the map.
const HEADER_SWIPE_THRESHOLD = 28;
// Duration of the hide/reveal slide. MUST equal --farm-header-ms in index.css
// (the stylesheet is the single source of truth for the animation; this copy only
// tells the map how long to keep following the header's moving edge).
// It was 280ms; the slide is now three times slower (840ms).
const HEADER_ANIM_MS = 840;
// A toggle that arrives while the previous slide has barely started is ignored, so
// a quick back-and-forth wobble cannot start overlapping slides.
const HEADER_TOGGLE_COOLDOWN_MS = 320;
// Standard "collapsing toolbar" convention: dragging the map content UP (like
// scrolling down a page) hides the header; dragging it DOWN (scrolling up)
// reveals it. Set to false to invert.
const HIDE_HEADER_WHEN_FINGER_MOVES_UP = true;

// Zoom limits of the pan/zoom surface (unchanged).
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

function useIsMobileLayout(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_LAYOUT_QUERY).matches
      : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return matches;
}

function LoginPage({
  authInstance,
}: {
  authInstance: Auth;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');

  const resetFormForMode = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setAuthError('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');

    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setAuthError('اكتب اسم المستخدم.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(normalizedUsername)) {
      setAuthError('اسم المستخدم يجب أن يحتوي على أحرف إنجليزية أو أرقام أو . _ - فقط، وبطول 3 إلى 64 حرفاً.');
      return;
    }
    if (!password) {
      setAuthError('اكتب كلمة المرور.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setAuthError('كلمة المرور يجب أن تحتوي على 6 أحرف أو أرقام على الأقل.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setAuthError('تأكيد كلمة المرور غير مطابق.');
      return;
    }

    setSubmitting(true);
    try {
      await setPersistence(authInstance, browserLocalPersistence);
      const authEmail = usernameToAuthEmail(normalizedUsername);

      if (mode === 'login') {
        await signInWithEmailAndPassword(authInstance, authEmail, password);
      } else {
        const credential = await createUserWithEmailAndPassword(authInstance, authEmail, password);
        await updateProfile(credential.user, { displayName: normalizedUsername });
      }
    } catch (err) {
      console.error(mode === 'login' ? 'Login error:' : 'Signup error:', err);
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : undefined;
      setAuthError(authErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-emerald-900 text-white px-7 py-8 text-center">
            <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-lg">
              <Leaf size={34} />
            </div>
            <h1 className="text-2xl font-bold m-0">مزرعة الساداتي</h1>
            <p className="text-emerald-200 text-sm mt-2 mb-0">
              {isSignup ? 'إنشاء حساب جديد لإدارة المزرعة' : 'تسجيل الدخول إلى نظام إدارة المزرعة'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-7 space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">اسم المستخدم</label>
              <div className="relative">
                <UserRound size={19} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  disabled={submitting}
                  placeholder="اسم المستخدم"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50 py-3 pr-10 pl-3 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                />
              </div>
              {isSignup && (
                <p className="mt-2 text-xs text-gray-500">استخدم 3 إلى 64 حرفاً إنجليزياً أو أرقاماً أو . _ -</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">كلمة المرور</label>
              <div className="relative">
                <LockKeyhole size={19} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  disabled={submitting}
                  placeholder="كلمة المرور"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50 py-3 pr-10 pl-12 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={submitting}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 disabled:opacity-50"
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>

            {isSignup && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">تأكيد كلمة المرور</label>
                <div className="relative">
                  <LockKeyhole size={19} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={submitting}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 py-3 pr-10 pl-12 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    disabled={submitting}
                    aria-label={showConfirmPassword ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 disabled:opacity-50"
                  >
                    {showConfirmPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>
            )}

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-emerald-700 py-3 text-white font-bold shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <LogIn size={18} />
              {submitting
                ? (isSignup ? 'جاري إنشاء الحساب...' : 'جاري تسجيل الدخول...')
                : (isSignup ? 'إنشاء الحساب' : 'تسجيل الدخول')}
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => resetFormForMode(isSignup ? 'login' : 'signup')}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-emerald-800 font-bold transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSignup ? 'لدي حساب بالفعل — تسجيل الدخول' : 'مستخدم جديد — إنشاء حساب'}
            </button>

            <p className="text-center text-xs text-gray-500 leading-6 m-0">
              كلمات المرور تتم إدارتها بأمان بواسطة Firebase Authentication، ولا يتم حفظها في Firestore أو Local Storage.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | { uid: string } | null>(null);
  const [cellsData, setCellsData] = useState<CellsData>({});
  const [rowsCount, setRowsCount] = useState(DEFAULT_ROWS);
  const [colsCount, setColsCount] = useState(DEFAULT_COLS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState<'offline' | 'syncing' | 'synced' | 'error'>(
    isFirebaseConfigured && typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'syncing'
  );

  // أوضاع التطبيق: 'view' (لإدارة الأشجار) | 'edit' (لتخطيط المزرعة والممرات)
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const [selectedTree, setSelectedTree] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<CellData>({});

  // منتقي نوع الخلية في وضع التخطيط (بديل التبديل التلقائي القديم)
  const [typePicker, setTypePicker] = useState<{ cellId: string; x: number; y: number } | null>(null);

  // قائمة "إضافة صف/عمود" الموحّدة + تأكيد إعادة تعيين المزرعة بالكامل
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Physical rows can be marked as unnumbered (useful for a road/drainage row).
  // These are stored by physical row index so the existing cell IDs stay unchanged.
  const [unlabeledRows, setUnlabeledRows] = useState<number[]>([]);
  const [unlabeledCols, setUnlabeledCols] = useState<number[]>([]);
  const [rowGapKinds, setRowGapKinds] = useState<Record<number, GapKind>>({});
  const [colGapKinds, setColGapKinds] = useState<Record<number, GapKind>>({});
  const [showRowNumberMenu, setShowRowNumberMenu] = useState(false);
  const [showColNumberMenu, setShowColNumberMenu] = useState(false);

  const [showLegend, setShowLegend] = useState(false);
  // Realistic (drone view) mode: state machine only. Nothing heavy exists until the user confirms.
  const realistic = useRealisticMode();
  // Set by <RealisticLayer> while Realistic mode is on; called after every pan/zoom transform write.
  const realisticViewListenerRef = useRef<(() => void) | null>(null);
  const farmDocumentExistsRef = useRef(false);

  // ---- Map orientation (mirroring). A DISPLAY choice only: logical rows, columns,
  // cell ids and landmark slots never change (see farm/orientation.ts).
  const [orientation, setOrientation] = useState<MapOrientation>('original');

  // ---- Landmarks. Instances live in their own map on the farm document, keyed by
  // stable id, and custom types in `landmarkTypes`; neither is ever mixed into
  // `cells` (the tree records).
  const [landmarks, setLandmarks] = useState<LandmarkMap>({});
  const [landmarkTypes, setLandmarkTypes] = useState<LandmarkTypeMap>({});
  // Always the latest values, so two quick placements can never build on a stale map.
  const landmarksRef = useRef<LandmarkMap>({});
  const landmarkTypesRef = useRef<LandmarkTypeMap>({});
  landmarksRef.current = landmarks;
  landmarkTypesRef.current = landmarkTypes;
  const [showPalette, setShowPalette] = useState(false);
  // Non-null while the user is tapping the map: placing one type again and again,
  // or moving one placed object.
  type PlaceSession =
    | { kind: 'place'; typeId: string; placedIds: string[] }
    | { kind: 'move'; landmarkId: string };
  const [session, setSession] = useState<PlaceSession | null>(null);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(null);
  const [confirmDeleteLandmark, setConfirmDeleteLandmark] = useState(false);
  const [placeMessage, setPlaceMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // ---- Mobile header auto-hide
  const isMobileLayout = useIsMobileLayout();
  const [headerHidden, setHeaderHidden] = useState(false);
  const headerHiddenRef = useRef(false);
  const headerAnimUntilRef = useRef(0);
  const headerToggledAtRef = useRef(0);
  const swipeRef = useRef({ x: 0, y: 0 });
  const headerCollapsed = isMobileLayout && headerHidden;

  const rowLabels = React.useMemo(
    () => Array.from({ length: rowsCount }, (_, i) => getRowLabel(i)),
    [rowsCount]
  );

  // Display coordinates are separate from the internal (stored) cell ids. The
  // numeric row/column numbers and the full "001-012" coordinate are derived from
  // physical position + which rows/columns are unnumbered; nothing stored changes.
  const coordMap = React.useMemo(
    () => buildCoordinateMap(rowsCount, colsCount, unlabeledRows, unlabeledCols),
    [rowsCount, colsCount, unlabeledRows, unlabeledCols]
  );
  const displayRowLabels = coordMap.rowLabels;

  const toggleRowNumber = (rowIndex: number) => {
    const exists = unlabeledRows.includes(rowIndex);
    const next = exists
      ? unlabeledRows.filter((i) => i !== rowIndex)
      : [...unlabeledRows, rowIndex];
    next.sort((a, b) => a - b);

    const nextKinds = { ...rowGapKinds };
    if (exists) delete nextKinds[rowIndex];
    else if (!nextKinds[rowIndex]) nextKinds[rowIndex] = 'gap';

    setUnlabeledRows(next);
    setRowGapKinds(nextKinds);
    persistFarmState(cellsData, rowsCount, colsCount, next, unlabeledCols, nextKinds, colGapKinds);
  };

  const setRowGapKind = (rowIndex: number, kind: GapKind) => {
    if (!unlabeledRows.includes(rowIndex)) return;
    const nextKinds = { ...rowGapKinds, [rowIndex]: kind };
    setRowGapKinds(nextKinds);
    persistFarmState(cellsData, rowsCount, colsCount, unlabeledRows, unlabeledCols, nextKinds, colGapKinds);
  };

  // Column header text comes from the same coordinate map (see above).
  const displayColLabels = coordMap.colLabels;

  const toggleColNumber = (colIndex: number) => {
    const exists = unlabeledCols.includes(colIndex);
    const next = exists
      ? unlabeledCols.filter((i) => i !== colIndex)
      : [...unlabeledCols, colIndex];
    next.sort((a, b) => a - b);

    const nextKinds = { ...colGapKinds };
    if (exists) delete nextKinds[colIndex];
    else if (!nextKinds[colIndex]) nextKinds[colIndex] = 'gap';

    setUnlabeledCols(next);
    setColGapKinds(nextKinds);
    persistFarmState(cellsData, rowsCount, colsCount, unlabeledRows, next, rowGapKinds, nextKinds);
  };

  const setColGapKind = (colIndex: number, kind: GapKind) => {
    if (!unlabeledCols.includes(colIndex)) return;
    const nextKinds = { ...colGapKinds, [colIndex]: kind };
    setColGapKinds(nextKinds);
    persistFarmState(cellsData, rowsCount, colsCount, unlabeledRows, unlabeledCols, rowGapKinds, nextKinds);
  };

  // ---- تحريك وتكبير/تصغير ----
  // High-frequency map interactions stay outside React state. Geometry is cached
  // and visual updates are batched with requestAnimationFrame so the 1,800-cell
  // schedule is not re-rendered on every wheel/pointer event.
  const scaleRef = useRef(1);
  const targetScaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const targetPosRef = useRef({ x: 0, y: 0 });
  const panZoomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformFrameRef = useRef<number | null>(null);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelPointRef = useRef({ x: 0, y: 0 });
  const lastZoomFrameTimeRef = useRef<number | null>(null);
  const metricsRef = useRef({ viewportW: 0, viewportH: 0, contentW: 0, contentH: 0 });
  const lowZoomClassRef = useRef(false);
  const xLowZoomClassRef = useRef(false);
  const landRef = useRef<HTMLDivElement>(null);
  const containerTopRef = useRef<number | null>(null);

  const clampScale = (s: number) => Math.min(Math.max(MIN_SCALE, s), MAX_SCALE);

  const measureMap = useCallback(() => {
    const container = containerRef.current;
    const content = panZoomRef.current;
    if (!container || !content) return metricsRef.current;

    metricsRef.current = {
      viewportW: container.clientWidth,
      viewportH: container.clientHeight,
      contentW: content.offsetWidth,
      contentH: content.offsetHeight,
    };
    return metricsRef.current;
  }, []);

  const clampPosition = useCallback(
    (x: number, y: number, scale = scaleRef.current) => clampView(x, y, scale, metricsRef.current),
    [],
  );

  const writeTransform = useCallback(() => {
    const content = panZoomRef.current;
    if (!content) return;

    const nextPos = clampPosition(posRef.current.x, posRef.current.y, scaleRef.current);
    posRef.current = nextPos;
    content.style.transform = `translate3d(${nextPos.x}px, ${nextPos.y}px, 0) scale(${scaleRef.current})`;
    // Realistic mode redraws its canvas in the same frame, so it never lags behind the cells.
    realisticViewListenerRef.current?.();

    const shouldUseLowZoom = scaleRef.current < 0.55;
    if (shouldUseLowZoom !== lowZoomClassRef.current) {
      lowZoomClassRef.current = shouldUseLowZoom;
      content.classList.toggle('farm-map-low-zoom', shouldUseLowZoom);
    }
    // Second tier so landmark badges stay visible when the whole farm is in view.
    const shouldUseXLowZoom = scaleRef.current < 0.3;
    if (shouldUseXLowZoom !== xLowZoomClassRef.current) {
      xLowZoomClassRef.current = shouldUseXLowZoom;
      content.classList.toggle('farm-map-xlow-zoom', shouldUseXLowZoom);
    }
  }, [clampPosition]);

  const scheduleTransform = useCallback(() => {
    if (transformFrameRef.current !== null) return;
    transformFrameRef.current = requestAnimationFrame(() => {
      transformFrameRef.current = null;
      writeTransform();
    });
  }, [writeTransform]);

  const stopZoomAnimation = useCallback(() => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current);
      zoomAnimationFrameRef.current = null;
    }
    lastZoomFrameTimeRef.current = null;
  }, []);

  const animateZoom = useCallback(() => {
    if (zoomAnimationFrameRef.current !== null) return;

    const tick = (time: number) => {
      const last = lastZoomFrameTimeRef.current ?? time;
      const dt = Math.min(40, Math.max(8, time - last));
      lastZoomFrameTimeRef.current = time;

      // Frame-rate independent exponential easing: responsive without jumps.
      const t = 1 - Math.exp(-dt / 90);
      const scaleDelta = targetScaleRef.current - scaleRef.current;
      const xDelta = targetPosRef.current.x - posRef.current.x;
      const yDelta = targetPosRef.current.y - posRef.current.y;

      scaleRef.current += scaleDelta * t;
      posRef.current = {
        x: posRef.current.x + xDelta * t,
        y: posRef.current.y + yDelta * t,
      };
      writeTransform();

      const settled = Math.abs(scaleDelta) < 0.0005 && Math.abs(xDelta) < 0.05 && Math.abs(yDelta) < 0.05;
      if (settled) {
        scaleRef.current = targetScaleRef.current;
        posRef.current = clampPosition(targetPosRef.current.x, targetPosRef.current.y, scaleRef.current);
        writeTransform();
        zoomAnimationFrameRef.current = null;
        lastZoomFrameTimeRef.current = null;
        return;
      }

      zoomAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    zoomAnimationFrameRef.current = requestAnimationFrame(tick);
  }, [clampPosition, writeTransform]);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, newScaleRaw: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const oldScale = scaleRef.current;
    const newScale = clampScale(newScaleRaw);
    if (Math.abs(newScale - oldScale) < 0.0001) return;

    const worldX = (px - posRef.current.x) / oldScale;
    const worldY = (py - posRef.current.y) / oldScale;
    const desiredPos = clampPosition(
      px - worldX * newScale,
      py - worldY * newScale,
      newScale
    );

    targetScaleRef.current = newScale;
    targetPosRef.current = desiredPos;
    animateZoom();
  }, [animateZoom, clampPosition]);

  // Reset view: show the WHOLE farm as it is currently displayed, centred. The
  // target comes from the land's measured rectangle (what the browser actually laid
  // out for the current orientation), never from an assumed top-left corner, and it
  // does not change the orientation. It goes through the same transform and zoom
  // limits as every other view change.
  const resetView = useCallback(() => {
    const land = landRef.current;
    const metrics = measureMap();
    if (!land) return;
    const view = computeFitView(
      metrics,
      { left: land.offsetLeft, top: land.offsetTop, width: land.offsetWidth, height: land.offsetHeight },
      { minScale: MIN_SCALE, maxScale: MAX_SCALE },
    );
    stopZoomAnimation();
    scaleRef.current = view.scale;
    targetScaleRef.current = view.scale;
    posRef.current = { x: view.x, y: view.y };
    targetPosRef.current = posRef.current;
    writeTransform();
  }, [measureMap, stopZoomAnimation, writeTransform]);

  const getRealisticView = useCallback(
    () => ({ scale: scaleRef.current, x: posRef.current.x, y: posRef.current.y }),
    [],
  );

  const zoomInBtn = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleRef.current * 1.2);
  }, [zoomAtPoint]);

  const zoomOutBtn = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleRef.current / 1.2);
  }, [zoomAtPoint]);

  // ---- Mouse wheel: accumulate wheel bursts and feed one smooth zoom target
  // per frame. This keeps the map responsive without React renders per event.
  const handleWheel = useCallback((e: WheelEvent | React.WheelEvent) => {
    // Prevent the browser/page from scrolling while the pointer is over the farm map.
    e.preventDefault();

    const normalizedDelta = e.deltaMode === 1
      ? e.deltaY * 16
      : e.deltaMode === 2
        ? e.deltaY * (containerRef.current?.clientHeight || 800)
        : e.deltaY;

    wheelDeltaRef.current += normalizedDelta;
    wheelPointRef.current = { x: e.clientX, y: e.clientY };

    if (wheelFrameRef.current !== null) return;
    wheelFrameRef.current = requestAnimationFrame(() => {
      wheelFrameRef.current = null;
      const delta = wheelDeltaRef.current;
      wheelDeltaRef.current = 0;
      if (!delta) return;

      const point = wheelPointRef.current;
      const factor = Math.exp(-delta * 0.0015);
      // Build on the latest requested scale so fast wheel bursts never get lost
      // while the smooth animation is still catching up.
      const baseScale = targetScaleRef.current;
      zoomAtPoint(point.x, point.y, baseScale * factor);
    });
  }, [zoomAtPoint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    measureMap();
    containerTopRef.current = container.getBoundingClientRect().top;

    const resizeObserver = new ResizeObserver(() => {
      const top = container.getBoundingClientRect().top;
      const lastTop = containerTopRef.current;
      containerTopRef.current = top;
      measureMap();

      // While the mobile header slides away/back, the map viewport grows/shrinks
      // at its TOP edge. Shift the map by the same amount so the content stays put
      // under the finger instead of jumping. Only during that animation: every
      // other layout change keeps its original behaviour.
      if (lastTop !== null && performance.now() < headerAnimUntilRef.current) {
        const shift = lastTop - top;
        if (shift !== 0) {
          posRef.current = { x: posRef.current.x, y: posRef.current.y + shift };
          targetPosRef.current = { x: targetPosRef.current.x, y: targetPosRef.current.y + shift };
          if (panStart.current) panStart.current = { x: panStart.current.x, y: panStart.current.y - shift };
        }
      }

      const clamped = clampPosition(posRef.current.x, posRef.current.y, scaleRef.current);
      posRef.current = clamped;
      targetPosRef.current = clampPosition(targetPosRef.current.x, targetPosRef.current.y, targetScaleRef.current);
      if (performance.now() < headerAnimUntilRef.current) writeTransform(); // same frame, no 1-frame lag
      else scheduleTransform();
    });
    resizeObserver.observe(container);
    if (panZoomRef.current) resizeObserver.observe(panZoomRef.current);

    const initialFrame = requestAnimationFrame(() => {
      measureMap();
      const initialPos = clampPosition(posRef.current.x, posRef.current.y, scaleRef.current);
      posRef.current = initialPos;
      targetPosRef.current = initialPos;
      scheduleTransform();
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(initialFrame);
      if (wheelFrameRef.current !== null) cancelAnimationFrame(wheelFrameRef.current);
      if (transformFrameRef.current !== null) cancelAnimationFrame(transformFrameRef.current);
      stopZoomAnimation();
      wheelFrameRef.current = null;
      transformFrameRef.current = null;
      wheelDeltaRef.current = 0;
    };
    // `loading, user`: the map container only exists once loading has finished and a
    // user is present (same reason as the wheel effect below). Without them this effect
    // ran once, while the loading spinner was showing, found no container and returned,
    // so the observer was never attached.
  }, [clampPosition, measureMap, scheduleTransform, stopZoomAnimation, writeTransform, loading, user]);

  // React registers wheel handlers as passive, so preventDefault() inside them is
  // ignored (and logs an error on every tick). A native non-passive listener lets
  // the map really capture the wheel. The map container only exists once loading
  // has finished and a user is present, so this effect re-runs on those changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel, loading, user]);

  // Re-measure when the physical grid size changes, without disturbing the
  // user's zoom unless the new dimensions require clamping.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      measureMap();
      const next = clampPosition(posRef.current.x, posRef.current.y, scaleRef.current);
      posRef.current = next;
      targetPosRef.current = clampPosition(targetPosRef.current.x, targetPosRef.current.y, targetScaleRef.current);
      scheduleTransform();
    });
    return () => cancelAnimationFrame(frame);
  }, [rowsCount, colsCount, measureMap, clampPosition, scheduleTransform]);

  // Show the whole farm once the data has loaded, and again whenever the user picks
  // another orientation (the picture just changed, so the old pan position is
  // meaningless). Same fit as the Reset View button.
  const didInitialFitRef = useRef(false);
  const fittedOrientationRef = useRef<MapOrientation>('original');
  useEffect(() => {
    if (!user) didInitialFitRef.current = false;
  }, [user]);
  useEffect(() => {
    if (loading || !user) return;
    if (didInitialFitRef.current && fittedOrientationRef.current === orientation) return;
    const frame = requestAnimationFrame(() => {
      didInitialFitRef.current = true;
      fittedOrientationRef.current = orientation;
      resetView();
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, user, orientation, resetView]);

  // ---- تحميل البيانات عند بدء التشغيل: Firebase لو متاح، وإلا محلياً ----
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      try {
        const saved = localStorage.getItem(getLocalStorageKey(null));
        if (saved) {
          const parsed = JSON.parse(saved);
          setCellsData(parsed.cells || {});
          setRowsCount(parsed.rowsCount || DEFAULT_ROWS);
          setColsCount(parsed.colsCount || DEFAULT_COLS);
          setUnlabeledRows(Array.isArray(parsed.unlabeledRows) ? parsed.unlabeledRows.filter((n: unknown) => Number.isInteger(n)) : []);
          setUnlabeledCols(Array.isArray(parsed.unlabeledCols) ? parsed.unlabeledCols.filter((n: unknown) => Number.isInteger(n)) : []);
          setRowGapKinds(parsed.rowGapKinds && typeof parsed.rowGapKinds === 'object' ? parsed.rowGapKinds : {});
          setColGapKinds(parsed.colGapKinds && typeof parsed.colGapKinds === 'object' ? parsed.colGapKinds : {});
          setLandmarks(normalizeLandmarks(parsed.landmarks));
          setLandmarkTypes(normalizeLandmarkTypes(parsed.landmarkTypes));
          setOrientation(normalizeOrientation(parsed.mapOrientation));
        } else {
          setCellsData({});
        }
      } catch (err) {
        console.error('Failed to read local storage', err);
        setError('تعذر قراءة البيانات المحفوظة محلياً.');
      }
      setSyncStatus('synced');
      setUser({ uid: 'local-user' });
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Never carry one user's farm UI into another user's session.
      setCellsData({});
      setRowsCount(DEFAULT_ROWS);
      setColsCount(DEFAULT_COLS);
      setUnlabeledRows([]);
      setUnlabeledCols([]);
      setRowGapKinds({});
      setColGapKinds({});
      setLandmarks({});
      setLandmarkTypes({});
      setOrientation('original');
      setSession(null);
      setShowPalette(false);
      setSelectedLandmarkId(null);
      setConfirmDeleteLandmark(false);
      farmDocumentExistsRef.current = false;
      setUser(currentUser);
      setError('');

      if (currentUser) {
        setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
      } else {
        setSyncStatus(navigator.onLine ? 'synced' : 'offline');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // ---- المزامنة الحية من Firestore (لو Firebase مفعّل فقط) ----
  useEffect(() => {
    if (!isFirebaseConfigured || !db || !user || !('uid' in user) || user.uid === 'local-user') return;

    const docRef = getFarmDocumentRef(db, user.uid);

    setLoading(true);
    const unsubscribe = onSnapshot(
      docRef,
      { includeMetadataChanges: true },
      (docSnap) => {
        farmDocumentExistsRef.current = docSnap.exists();
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.ownerUid && data.ownerUid !== user.uid) {
            console.error('Farm ownership mismatch for current user. Refusing to load another user\'s farm.');
            setCellsData({});
            setRowsCount(DEFAULT_ROWS);
            setColsCount(DEFAULT_COLS);
            setUnlabeledRows([]);
            setUnlabeledCols([]);
            setRowGapKinds({});
            setColGapKinds({});
            setLandmarks({});
            setLandmarkTypes({});
            setOrientation('original');
            setError('تعذر تحميل مزرعة هذا الحساب بأمان. تحقق من بيانات Firestore.');
            setSyncStatus('error');
            setLoading(false);
            return;
          }
          setCellsData(data.cells || {});
          setRowsCount(data.rowsCount || DEFAULT_ROWS);
          setColsCount(data.colsCount || DEFAULT_COLS);
          setUnlabeledRows(Array.isArray(data.unlabeledRows) ? data.unlabeledRows.filter((n): n is number => Number.isInteger(n)) : []);
          setUnlabeledCols(Array.isArray(data.unlabeledCols) ? data.unlabeledCols.filter((n): n is number => Number.isInteger(n)) : []);
          setRowGapKinds(data.rowGapKinds && typeof data.rowGapKinds === 'object' ? data.rowGapKinds as Record<number, GapKind> : {});
          setColGapKinds(data.colGapKinds && typeof data.colGapKinds === 'object' ? data.colGapKinds as Record<number, GapKind> : {});
          // Optional field: farms saved before landmarks existed simply have none.
          setLandmarks(normalizeLandmarks(data.landmarks));
          setLandmarkTypes(normalizeLandmarkTypes(data.landmarkTypes));
          setOrientation(normalizeOrientation(data.mapOrientation));
          if (!data.ownerUid && navigator.onLine) {
            // Backfill ownership metadata without changing the existing farm shape.
            setDoc(docRef, { ownerUid: user.uid }, { merge: true }).catch((err) => {
              console.error('Failed to add farm ownership metadata', err);
            });
          }
        } else {
          // A brand-new Firebase user gets a brand-new, empty farm document.
          // This is deliberately created at the user's own UID path only.
          const emptyFarm = {
            ownerUid: user.uid,
            cells: {},
            rowsCount: DEFAULT_ROWS,
            colsCount: DEFAULT_COLS,
            unlabeledRows: [],
            unlabeledCols: [],
            rowGapKinds: {},
            colGapKinds: {},
            landmarks: {},
            landmarkTypes: {},
          };
          setCellsData({});
          setRowsCount(DEFAULT_ROWS);
          setColsCount(DEFAULT_COLS);
          setUnlabeledRows([]);
          setUnlabeledCols([]);
          setRowGapKinds({});
          setColGapKinds({});
          setLandmarks({});
          setLandmarkTypes({});
          setOrientation('original');
          farmDocumentExistsRef.current = true;
          setDoc(docRef, emptyFarm, { merge: true }).catch((err) => {
            console.error('Failed to initialize new user farm', err);
            farmDocumentExistsRef.current = false;
            if (navigator.onLine) {
              setError('تعذر إنشاء مزرعة هذا الحساب في Firestore.');
              setSyncStatus('error');
            }
          });
        }

        if (!navigator.onLine) {
          setSyncStatus('offline');
        } else if (docSnap.metadata.hasPendingWrites || docSnap.metadata.fromCache) {
          setSyncStatus('syncing');
        } else {
          setSyncStatus('synced');
        }
        setLoading(false);
      },
      (err) => {
        console.error('Firestore error:', err);
        if (!navigator.onLine) {
          setSyncStatus('offline');
        } else {
          const code = (err as { code?: string }).code;
          if (code === 'permission-denied') {
            setError('ليس لديك صلاحية الوصول إلى بيانات هذه المزرعة.');
          } else if (code === 'unauthenticated') {
            setError('انتهت جلسة المصادقة مع Firebase.');
          } else {
            setError('حدث خطأ حقيقي أثناء المزامنة مع Firestore.');
          }
          setSyncStatus('error');
        }
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [user]);

  // navigator.onLine is only a network hint. Firestore snapshot metadata below
  // remains the source of truth for whether queued writes have actually synced.
  useEffect(() => {
    if (!isFirebaseConfigured) return;

    const handleOffline = () => setSyncStatus('offline');
    const handleOnline = () => setSyncStatus('syncing');

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // ---- حفظ موحّد للخلايا وأبعاد الشبكة: يكتب للسحابة لو متاحة، وإلا محلياً ----
  const persistFarmState = useCallback(async (
    nextCells: CellsData,
    nextRows: number,
    nextCols: number,
    nextUnlabeledRows = unlabeledRows,
    nextUnlabeledCols = unlabeledCols,
    nextRowGapKinds = rowGapKinds,
    nextColGapKinds = colGapKinds,
    nextLandmarks = landmarks,
    nextLandmarkTypes = landmarkTypes,
    nextOrientation = orientation,
  ) => {
    const cleanedUnlabeledRows = nextUnlabeledRows.filter((index) => Number.isInteger(index) && index >= 0 && index < nextRows);
    const cleanedUnlabeledCols = nextUnlabeledCols.filter((index) => Number.isInteger(index) && index >= 0 && index < nextCols);
    const cleanedRowGapKinds = Object.fromEntries(
      Object.entries(nextRowGapKinds).filter(([key, value]) => {
        const index = Number(key);
        return Number.isInteger(index) && cleanedUnlabeledRows.includes(index) && ['road', 'drainage', 'gap'].includes(value);
      })
    ) as Record<number, GapKind>;
    const cleanedColGapKinds = Object.fromEntries(
      Object.entries(nextColGapKinds).filter(([key, value]) => {
        const index = Number(key);
        return Number.isInteger(index) && cleanedUnlabeledCols.includes(index) && ['road', 'drainage', 'gap'].includes(value);
      })
    ) as Record<number, GapKind>;

    setCellsData(nextCells);
    setRowsCount(nextRows);
    setColsCount(nextCols);
    setUnlabeledRows(cleanedUnlabeledRows);
    setUnlabeledCols(cleanedUnlabeledCols);
    setRowGapKinds(cleanedRowGapKinds);
    setColGapKinds(cleanedColGapKinds);
    setLandmarks(nextLandmarks);
    setLandmarkTypes(nextLandmarkTypes);
    setOrientation(nextOrientation);

    const payload = {
      ownerUid: user && 'uid' in user && user.uid !== 'local-user' ? user.uid : undefined,
      cells: nextCells,
      rowsCount: nextRows,
      colsCount: nextCols,
      unlabeledRows: cleanedUnlabeledRows,
      unlabeledCols: cleanedUnlabeledCols,
      rowGapKinds: cleanedRowGapKinds,
      colGapKinds: cleanedColGapKinds,
      landmarks: nextLandmarks,
      landmarkTypes: nextLandmarkTypes,
      mapOrientation: nextOrientation,
    };

    if (isFirebaseConfigured && db && user && 'uid' in user && user.uid !== 'local-user') {
      const docRef = getFarmDocumentRef(db, user.uid);

      try {
        if (!farmDocumentExistsRef.current) {
          // First write creates the existing document shape without changing its path.
          await setDoc(docRef, payload, { merge: true });
          farmDocumentExistsRef.current = true;
          return;
        }

        // Keep normal edits granular so changing one cell does not overwrite an
        // unrelated cell changed by another tab/device. A full write is reserved
        // for large changes that cannot fit safely into one Firestore update.
        const updates: Record<string, unknown> = {};
        const cellIds = new Set([...Object.keys(cellsData), ...Object.keys(nextCells)]);
        let changedCells = 0;

        for (const cellId of cellIds) {
          const before = cellsData[cellId];
          const after = nextCells[cellId];
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          changedCells += 1;
          updates[`cells.${cellId}`] = after === undefined ? deleteField() : after;
        }

        // Landmarks are written per object (`landmarks.<id>`), exactly like cells,
        // so two devices adding different objects never overwrite each other and a
        // retried write of the same id is idempotent. Only the changed ids are sent.
        const landmarkIds = new Set([...Object.keys(landmarks), ...Object.keys(nextLandmarks)]);
        for (const id of landmarkIds) {
          if (JSON.stringify(landmarks[id]) === JSON.stringify(nextLandmarks[id])) continue;
          updates[`landmarks.${id}`] = nextLandmarks[id] === undefined ? deleteField() : nextLandmarks[id];
        }

        // Landmark types: same per-key pattern (`landmarkTypes.<id>`).
        const typeIds = new Set([...Object.keys(landmarkTypes), ...Object.keys(nextLandmarkTypes)]);
        for (const id of typeIds) {
          if (JSON.stringify(landmarkTypes[id]) === JSON.stringify(nextLandmarkTypes[id])) continue;
          updates[`landmarkTypes.${id}`] = nextLandmarkTypes[id] === undefined ? deleteField() : nextLandmarkTypes[id];
        }

        // Display preference stored with the other layout settings (one optional field).
        if (nextOrientation !== orientation) updates.mapOrientation = nextOrientation;

        if (nextRows !== rowsCount) updates.rowsCount = nextRows;
        if (nextCols !== colsCount) updates.colsCount = nextCols;
        if (JSON.stringify(cleanedUnlabeledRows) !== JSON.stringify(unlabeledRows)) updates.unlabeledRows = cleanedUnlabeledRows;
        if (JSON.stringify(cleanedUnlabeledCols) !== JSON.stringify(unlabeledCols)) updates.unlabeledCols = cleanedUnlabeledCols;
        if (JSON.stringify(cleanedRowGapKinds) !== JSON.stringify(rowGapKinds)) updates.rowGapKinds = cleanedRowGapKinds;
        if (JSON.stringify(cleanedColGapKinds) !== JSON.stringify(colGapKinds)) updates.colGapKinds = cleanedColGapKinds;

        if (changedCells > 400) {
          await setDoc(docRef, payload, { merge: true });
        } else if (Object.keys(updates).length > 0) {
          await updateDoc(docRef, updates);
        }
      } catch (err) {
        console.error('Failed to save to Firestore', err);
        const code = (err as { code?: string }).code;
        if (navigator.onLine) {
          if (code === 'permission-denied') {
            setError('ليس لديك صلاحية حفظ هذه التغييرات.');
          } else if (code === 'unauthenticated') {
            setError('انتهت جلسة المصادقة مع Firebase.');
          } else {
            setError('حدث خطأ حقيقي أثناء حفظ التغييرات في Firestore.');
          }
          setSyncStatus('error');
        } else {
          setSyncStatus('offline');
        }
      }
    } else {
      try {
        localStorage.setItem(getLocalStorageKey(user && 'uid' in user ? user.uid : null), JSON.stringify(payload));
        setSyncStatus('synced');
      } catch (err) {
        console.error('Failed to save locally', err);
        setError('تعذر حفظ البيانات محلياً (قد تكون مساحة التخزين ممتلئة).');
        setSyncStatus('error');
      }
    }
  }, [user, cellsData, rowsCount, colsCount, unlabeledRows, unlabeledCols, rowGapKinds, colGapKinds, landmarks, landmarkTypes, orientation]);

  const addRow = () => persistFarmState(cellsData, rowsCount + 1, colsCount);
  const addColumn = () => persistFarmState(cellsData, rowsCount, colsCount + 1);

  // إعادة تعيين المزرعة بالكامل: مسح كل بيانات الخلايا (أشجار/مروى/مصرف/طريق)
  // مع الإبقاء على حجم الشبكة الحالي (عدد الصفوف/الأعمدة) كما هو — قرار مقصود:
  // "reset" هنا يعني مسح البيانات لا تصغير الشبكة اللي وسّعتها بنفسك.
  const resetFarm = () => {
    setShowResetConfirm(false);
    persistFarmState({}, rowsCount, colsCount, [], [], {}, {});
  };

  // ============================================================================
  // التحكم الموحّد باللمس والفأرة عبر Pointer Events: إصبع واحد/فأرة = تحريك،
  // إصبعين = تكبير/تصغير بالقرص (pinch)، وتمييز "الضغطة/التابة" عن "السحب"
  // بحساب المسافة المقطوعة أثناء الحركة، ثم تحديد الخلية عبر إحداثيات آخر
  // نقطة (elementFromPoint) بدل معالج ضغط منفصل على كل خلية من آلاف الخلايا.
  // ============================================================================
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const pinchOccurred = useRef(false);
  const dragDistance = useRef(0);

  const getPointsArray = () => Array.from(pointers.current.values());

  const handleCellClick = (cellId: string, clientX?: number, clientY?: number) => {
    const cellData: CellData = cellsData[cellId] || { type: 'tree' };
    const currentType = cellData.type || 'tree';

    if (mode === 'edit') {
      setTypePicker({
        cellId,
        x: clientX ?? window.innerWidth / 2,
        y: clientY ?? window.innerHeight / 2,
      });
    } else if (currentType === 'tree') {
      setSelectedTree(cellId);
      setFormData({
        variety: cellData.variety || 'غير محدد',
        status: cellData.status || 'سليمة',
        disease: cellData.disease || 'لا يوجد',
        pruneDate: cellData.pruneDate || '',
        notes: cellData.notes || '',
      });
      setIsModalOpen(true);
    }
  };

  const chooseTypeForCell = (type: CellType) => {
    if (!typePicker) return;
    const { cellId } = typePicker;
    const existing = cellsData[cellId] || {};
    const updatedCells: CellsData = { ...cellsData, [cellId]: { ...existing, type } };
    setTypePicker(null);
    persistFarmState(updatedCells, rowsCount, colsCount);
  };

  // ---- Mobile header: hide on a deliberate upward drag, reveal on a downward one.
  const applyHeaderHidden = (next: boolean, force = false) => {
    if (headerHiddenRef.current === next) return;
    const now = performance.now();
    // A flick that reverses a slide which has only just started is ignored (the
    // swipe has to continue to count), so slides never pile up. The handle button
    // always works (force).
    if (!force && now - headerToggledAtRef.current < HEADER_TOGGLE_COOLDOWN_MS) return;
    headerToggledAtRef.current = now;
    headerHiddenRef.current = next;
    // Window during which the map is shifted to follow the header's slide
    // (the full slide plus a little slack).
    headerAnimUntilRef.current = now + HEADER_ANIM_MS + 120;
    setHeaderHidden(next);
  };

  const trackHeaderSwipe = (dx: number, dy: number) => {
    const run = swipeRef.current;
    // Reversing direction starts a new run, so a wobble never counts as a swipe.
    if (dy !== 0 && run.y !== 0 && Math.sign(dy) !== Math.sign(run.y)) {
      run.x = 0;
      run.y = 0;
    }
    run.x += dx;
    run.y += dy;
    if (Math.abs(run.y) < HEADER_SWIPE_THRESHOLD) return;
    // A mostly-sideways pan is not a header gesture.
    if (Math.abs(run.y) < Math.abs(run.x) * 1.2) {
      run.x = 0;
      run.y = 0;
      return;
    }
    const fingerMovedUp = run.y < 0;
    applyHeaderHidden(HIDE_HEADER_WHEN_FINGER_MOVES_UP ? fingerMovedUp : !fingerMovedUp);
    run.x = 0;
    run.y = 0;
  };

  // Leaving the phone layout (rotation / resize / desktop) always restores the header.
  useEffect(() => {
    if (!isMobileLayout && headerHiddenRef.current) {
      headerHiddenRef.current = false;
      setHeaderHidden(false);
    }
  }, [isMobileLayout]);

  // ---- Landmarks -----------------------------------------------------------
  // Where cell (0,0) is DRAWN: the label strips move with the mirroring, so every
  // overlay (infrastructure, landmarks, edit grid) shares this one origin.
  const gridOrigin = React.useMemo(() => getGridOrigin(orientation), [orientation]);

  // Pixel position of a screen point in the farm's own (unscaled) grid space,
  // measured from the top-left of DISPLAYED cell (0,0) - the origin the layers use.
  const clientToGridLocal = (clientX: number, clientY: number) => {
    const land = landRef.current;
    if (!land || !land.offsetWidth) return null;
    const rect = land.getBoundingClientRect();
    const scale = rect.width / land.offsetWidth;
    if (!scale) return null;
    return {
      x: (clientX - rect.left) / scale - land.clientLeft - gridOrigin.left,
      y: (clientY - rect.top) / scale - land.clientTop - gridOrigin.top,
    };
  };

  // Persist the landmark map (and optionally the custom types); every other
  // argument keeps its current value. The refs are updated first so a second tap in
  // the same moment builds on this result, not on a stale render.
  const commitLandmarks = (nextLandmarks: LandmarkMap, nextTypes: LandmarkTypeMap = landmarkTypesRef.current) => {
    landmarksRef.current = nextLandmarks;
    landmarkTypesRef.current = nextTypes;
    persistFarmState(cellsData, rowsCount, colsCount, undefined, undefined, undefined, undefined, nextLandmarks, nextTypes);
  };

  const startPlacing = (typeId: string) => {
    setShowPalette(false);
    setSelectedLandmarkId(null);
    setPlaceMessage(null);
    setSession({ kind: 'place', typeId, placedIds: [] });
  };

  const endSession = () => {
    setSession(null);
    setPlaceMessage(null);
  };

  const handlePlacementTap = (clientX: number, clientY: number, onLandmark = false) => {
    if (!session) return;
    if (onLandmark) {
      setPlaceMessage({ text: SLOT_BLOCK_MESSAGES.occupied, tone: 'error' });
      return;
    }
    const local = clientToGridLocal(clientX, clientY);
    if (!local) return;
    // A fingertip is wider than a gutter: taps within a few screen pixels of a
    // tree's edge still count as the neighbouring gutter. The middle of a tree never does.
    const slack = Math.min(Math.max(10 / scaleRef.current, 4), GRID.cellW * 0.4);
    const displaySlot = pickSlotAtPixel(local.x, local.y, rowsCount, colsCount, slack);
    if (!displaySlot) {
      setPlaceMessage({ text: SLOT_BLOCK_MESSAGES['tree-center'], tone: 'error' });
      return;
    }
    // Back to the LOGICAL lattice (the mirror is its own inverse).
    const slot = mirrorSlot(displaySlot, rowsCount, colsCount, orientation);
    const ctx = { rows: rowsCount, cols: colsCount, grid: kindGrid };
    const now = new Date().toISOString();

    if (session.kind === 'place') {
      const type = inventory.find((t) => t.id === session.typeId);
      if (!type) { endSession(); return; }
      const result = placeLandmark(landmarksRef.current, type, slot, ctx, now);
      if (result.ok === false) { setPlaceMessage({ text: result.message, tone: 'error' }); return; }
      commitLandmarks(result.landmarks);
      setSession({ ...session, placedIds: [...session.placedIds, result.landmark.id] });
      setPlaceMessage({ text: `تم وضع «${type.name}»`, tone: 'ok' });
    } else {
      const result = moveLandmark(landmarksRef.current, session.landmarkId, slot, ctx, now);
      if (result.ok === false) { setPlaceMessage({ text: result.message, tone: 'error' }); return; }
      commitLandmarks(result.landmarks);
      setSelectedLandmarkId(null);
      endSession();
    }
  };

  const undoLastPlacement = () => {
    if (!session || session.kind !== 'place' || session.placedIds.length === 0) return;
    const lastId = session.placedIds[session.placedIds.length - 1];
    commitLandmarks(removeLandmark(landmarksRef.current, lastId));
    setSession({ ...session, placedIds: session.placedIds.slice(0, -1) });
    setPlaceMessage(null);
  };

  // Create a type, then use it straight away.
  const handleCreateType = (name: string, icon: string): string | null => {
    const result = createLandmarkType(name, icon, landmarkTypesRef.current, new Date().toISOString());
    if (result.ok === false) return result.error;
    commitLandmarks(landmarksRef.current, { ...landmarkTypesRef.current, [result.type.id]: result.type });
    startPlacing(result.type.id);
    return null;
  };

  // A type can only be removed while nothing uses it, so deleting a type can never
  // delete (or orphan) placed objects.
  const handleDeleteType = (typeId: string) => {
    const entry = inventory.find((t) => t.id === typeId);
    if (!entry || entry.source !== 'custom' || entry.count > 0) return;
    const { [typeId]: _gone, ...rest } = landmarkTypesRef.current;
    commitLandmarks(landmarksRef.current, rest);
  };

  const saveLandmarkDetails = (patch: { typeId: string; note: string }) => {
    if (!selectedLandmarkId) return;
    const type = inventory.find((t) => t.id === patch.typeId);
    const result = updateLandmark(landmarksRef.current, selectedLandmarkId, { type, note: patch.note }, new Date().toISOString());
    setSelectedLandmarkId(null);
    if (result.ok) commitLandmarks(result.landmarks);
  };

  const confirmDeleteSelectedLandmark = () => {
    if (!selectedLandmarkId) return;
    const id = selectedLandmarkId;
    setConfirmDeleteLandmark(false);
    setSelectedLandmarkId(null);
    commitLandmarks(removeLandmark(landmarksRef.current, id));
  };

  // Placement only makes sense while laying out the farm.
  useEffect(() => {
    if (mode !== 'edit') {
      setSession(null);
      setShowPalette(false);
    }
  }, [mode]);

  // Result messages fade after a moment.
  useEffect(() => {
    if (!placeMessage) return;
    const timer = window.setTimeout(() => setPlaceMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [placeMessage]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }

    const wasEmpty = pointers.current.size === 0;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (wasEmpty) {
      dragDistance.current = 0;
      pinchOccurred.current = false;
      swipeRef.current = { x: 0, y: 0 };
    }

    if (pointers.current.size === 1) {
      stopZoomAnimation();
      const current = posRef.current;
      panStart.current = { x: e.clientX - current.x, y: e.clientY - current.y };
      targetPosRef.current = current;
      pinchStart.current = null;
      containerRef.current?.setAttribute('data-dragging', 'true');
    } else if (pointers.current.size === 2) {
      stopZoomAnimation();
      const pts = getPointsArray();
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStart.current = {
        distance: Math.hypot(dx, dy) || 1,
        scale: scaleRef.current,
      };
      panStart.current = null;
      pinchOccurred.current = true;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    const moveDx = e.clientX - prev.x;
    const moveDy = e.clientY - prev.y;
    dragDistance.current += Math.abs(moveDx) + Math.abs(moveDy);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (isMobileLayout && e.pointerType !== 'mouse' && pointers.current.size === 1 && !pinchOccurred.current && !session) {
      trackHeaderSwipe(moveDx, moveDy);
    }

    if (pointers.current.size === 1 && panStart.current) {
      const next = clampPosition(
        e.clientX - panStart.current.x,
        e.clientY - panStart.current.y,
        scaleRef.current
      );
      posRef.current = next;
      targetPosRef.current = next;
      scheduleTransform();
    } else if (pointers.current.size === 2 && pinchStart.current) {
      const pts = getPointsArray();
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const distance = Math.hypot(dx, dy) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      zoomAtPoint(midX, midY, pinchStart.current.scale * (distance / pinchStart.current.distance));
    }
  };

  const endGesture = (e: React.PointerEvent, isTapCandidate: boolean) => {
    pointers.current.delete(e.pointerId);

    if (pointers.current.size === 1) {
      const remaining = getPointsArray()[0];
      panStart.current = { x: remaining.x - posRef.current.x, y: remaining.y - posRef.current.y };
      pinchStart.current = null;
    } else if (pointers.current.size === 0) {
      containerRef.current?.removeAttribute('data-dragging');
      panStart.current = null;
      pinchStart.current = null;

      if (isTapCandidate && !pinchOccurred.current && dragDistance.current < 10) {
        // Placing / moving a landmark: the tap is consumed by that flow.
        if (session) {
          handlePlacementTap(e.clientX, e.clientY, (e.target as HTMLElement | null)?.closest?.('[data-landmark-id]') != null);
          return;
        }
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        // Landmarks are separate objects: a tap on one never selects a tree/cell.
        const landmarkEl = el?.closest('[data-landmark-id]') as HTMLElement | null;
        if (landmarkEl?.dataset.landmarkId) {
          setConfirmDeleteLandmark(false);
          setSelectedLandmarkId(landmarkEl.dataset.landmarkId);
          return;
        }
        const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null;
        if (cellEl?.dataset.cellId) {
          handleCellClick(cellEl.dataset.cellId, e.clientX, e.clientY);
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => endGesture(e, true);
  const handlePointerCancel = (e: React.PointerEvent) => endGesture(e, false);

  const handleSaveTreeData = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTree) return;

    try {
      const existingCellData = cellsData[selectedTree] || { type: 'tree' };
      const updatedCells: CellsData = {
        ...cellsData,
        [selectedTree]: { ...existingCellData, ...formData, type: 'tree', lastUpdated: new Date().toISOString() },
      };
      setIsModalOpen(false);
      await persistFarmState(updatedCells, rowsCount, colsCount);
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء الحفظ.');
    }
  };

  // ---- Connected infrastructure + memoised grid -------------------------------
  // The kind grid is derived from the stored data on every change, but it is
  // kept referentially stable while the infrastructure itself is unchanged, so
  // editing a tree never rebuilds or repaints the road/canal overlay.
  const kindGridRef = useRef<KindGrid | null>(null);
  const kindGrid = React.useMemo(() => {
    const next = buildKindGrid(cellsData, rowLabels, colsCount, rowGapKinds, colGapKinds);
    if (kindGridRef.current && kindGridRef.current.signature === next.signature) return kindGridRef.current;
    kindGridRef.current = next;
    return next;
  }, [cellsData, rowLabels, colsCount, rowGapKinds, colGapKinds]);

  // Human-readable coordinate of the tree whose modal is open (display only).
  const selectedTreeCoordinate = React.useMemo(() => {
    if (!selectedTree) return '';
    const parsed = parseCellId(selectedTree);
    const rowIndex = parsed ? rowLabels.indexOf(parsed.rowLabel) : -1;
    if (!parsed || rowIndex === -1 || parsed.colIndex >= colsCount) return selectedTree;
    return coordMap.describeAt(rowIndex, parsed.colIndex);
  }, [selectedTree, rowLabels, colsCount, coordMap]);

  const selectedCellId = mode === 'edit' ? (typePicker?.cellId ?? null) : (isModalOpen ? selectedTree : null);

  // ---- Landmark view-model (all derived; nothing here is stored) -------------
  const describeLandmarkSlot = React.useCallback(
    (slot: { x: number; y: number }) => describeSlot(slot, coordMap.describeAt, rowsCount, colsCount),
    [coordMap, rowsCount, colsCount]
  );

  // Palette entries (presets, custom types, types only known from placed objects)
  // with live instance counts.
  const inventory = React.useMemo(() => buildLandmarkInventory(landmarks, landmarkTypes), [landmarks, landmarkTypes]);

  // A saved landmark whose slot is no longer valid (a road/drain was later drawn
  // beside it, ...) is KEPT and flagged, never deleted or moved automatically.
  const landmarkConflictIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const lm of Object.values(landmarks)) {
      const reason = slotBlockedReason(lm.position, {
        rows: rowsCount, cols: colsCount, grid: kindGrid, landmarks: {}, ignoreId: lm.id,
      });
      if (reason) ids.add(lm.id);
    }
    return ids;
  }, [landmarks, kindGrid, rowsCount, colsCount]);

  const placedItems = React.useMemo<PlacedItem[]>(
    () => Object.values(landmarks)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.id < b.id ? -1 : 1))
      .map((landmark) => ({ landmark, where: describeLandmarkSlot(landmark.position), conflict: landmarkConflictIds.has(landmark.id) })),
    [landmarks, describeLandmarkSlot, landmarkConflictIds]
  );

  const selectedLandmark = selectedLandmarkId ? landmarks[selectedLandmarkId] ?? null : null;
  const sessionType = session?.kind === 'place' ? inventory.find((t) => t.id === session.typeId) ?? null : null;
  const sessionLandmark = session?.kind === 'move' ? landmarks[session.landmarkId] ?? null : null;
  const highlightedLandmarkId = session?.kind === 'move' ? session.landmarkId : selectedLandmarkId;
  const totalPlaced = placedItems.length;

  // ---- Orientation view-model --------------------------------------------------
  const flipX = flipsColumns(orientation);
  const flipY = flipsRows(orientation);
  // Displayed position -> logical index, per axis. Cells keep their stored ids and
  // records; only the order they are laid out in changes.
  const rowOrder = React.useMemo(() => displayOrder(rowsCount, flipY), [rowsCount, flipY]);
  const colOrder = React.useMemo(() => displayOrder(colsCount, flipX), [colsCount, flipX]);
  // The same infrastructure, re-laid-out for display (identical object when not mirrored).
  const displayKindGrid = React.useMemo(() => mirrorKindGrid(kindGrid, orientation), [kindGrid, orientation]);

  // Rebuilt only when map data / labels / mode / selection change - never on
  // pan, zoom, drag or sync-status updates. Each MapCell is itself memoised, so
  // a single edit re-renders a single cell.
  const gridCells = React.useMemo(() => {
    // Axis strips travel with the mirroring: the header row sits at the bottom when
    // the farm is flipped top<->bottom, the row-label column on the right when it is
    // flipped left<->right. DOM order = grid auto-placement order.
    const corner = <div key="corner" className={`farm-axis-cell farm-axis-corner ${flipY ? 'mt-2' : 'mb-2'}`}>#</div>;
    const headerRow = (
      <React.Fragment key="header-row">
        {!flipX && corner}
        {colOrder.map((c) => (
          <div
            key={`header-${c}`}
            className={`farm-axis-cell farm-axis-col ${flipY ? 'mt-2' : 'mb-2'} ${colGapKinds[c] ? `farm-axis-${colGapKinds[c]}` : ''}`}
          >
            {displayColLabels[c]}
          </div>
        ))}
        {flipX && corner}
      </React.Fragment>
    );

    return (
      <>
        {!flipY && headerRow}

        {/* صفوف المزرعة */}
        {rowOrder.map((rowIndex) => {
          const rowLetter = rowLabels[rowIndex];
          // حرف/رقم الصف المعروض؛ قد يكون فارغاً لصف طريق/مصرف
          const rowLabelCell = (
            <div key="row-label" className={`farm-axis-cell farm-axis-row sticky right-0 z-10 ${rowGapKinds[rowIndex] ? `farm-axis-${rowGapKinds[rowIndex]}` : ''}`}>
              {displayRowLabels[rowIndex]}
            </div>
          );
          return (
            <React.Fragment key={rowLetter}>
              {!flipX && rowLabelCell}
              {colOrder.map((colIndex) => {
                const cellId = `${rowLetter}-${colIndex + 1}`;
                // Visible coordinate ("12-07"); empty for cells in an unnumbered row/column.
                // The stored id above is never derived from it, nor from the orientation.
                const displayCellLabel = coordMap.coordinateAt(rowIndex, colIndex) ?? '';

                return (
                  <MapCell
                    key={cellId}
                    cellId={cellId}
                    data={cellsData[cellId]}
                    infraKind={kindAt(kindGrid, rowIndex, colIndex)}
                    gapKind={rowGapKinds[rowIndex] || colGapKinds[colIndex] || null}
                    label={displayCellLabel}
                    coordinate={coordMap.describeAt(rowIndex, colIndex)}
                    editMode={mode === 'edit'}
                    selected={selectedCellId === cellId}
                  />
                );
              })}
              {flipX && rowLabelCell}
            </React.Fragment>
          );
        })}

        {flipY && headerRow}
      </>
    );
  }, [cellsData, rowLabels, rowOrder, colOrder, flipX, flipY, displayRowLabels, displayColLabels, coordMap, rowGapKinds, colGapKinds, kindGrid, mode, selectedCellId]);

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      setError('');
      setSyncStatus('synced');
    } catch (err) {
      console.error('Logout error:', err);
      setError('تعذر تسجيل الخروج.');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50" dir="rtl">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-600"></div>
        <span className="mr-3 text-emerald-800 font-semibold text-lg">جاري التحميل...</span>
      </div>
    );
  }

  if (isFirebaseConfigured && !user) {
    return auth ? <LoginPage authInstance={auth} /> : null;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans overflow-hidden" dir="rtl">

      {/* شريط العنوان وأدوات التحكم في الوضع.
          على الجوال فقط: يُخفى بانزلاق عند سحب الخريطة للأعلى ويظهر عند السحب للأسفل
          (انظر useIsMobileLayout). على سطح المكتب الغلاف لا يغيّر شيئاً. */}
      <div className="farm-header-collapse" data-hidden={headerCollapsed ? 'true' : undefined}>
      <div className="farm-header-collapse-inner" aria-hidden={headerCollapsed ? true : undefined}>
      <header className="bg-emerald-900 text-white p-4 shadow-md flex flex-wrap gap-4 justify-between items-center z-20 relative">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg text-emerald-800">
            <Leaf size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold m-0 leading-tight">مزرعة رشاد الساداتي</h1>
              <span
                title={isFirebaseConfigured ? 'متصل بالمزامنة السحابية (Firebase)' : 'التخزين محلي على هذا الجهاز/المتصفح'}
                className="flex items-center gap-1 text-[10px] font-bold bg-emerald-950/60 border border-emerald-700 px-2 py-0.5 rounded-full text-emerald-200"
              >
                {isFirebaseConfigured ? <Cloud size={11} /> : <HardDrive size={11} />}
                {isFirebaseConfigured ? 'سحابي' : 'محلي'}
              </span>
            </div>
            <p className="text-emerald-200 text-sm m-0">نظام الإدارة الجغرافية التفاعلي</p>
          </div>
        </div>

        {/* أزرار التبديل بين الأوضاع */}
        <div className="flex bg-emerald-950 p-1 rounded-xl shadow-inner border border-emerald-800">
          <button
            onClick={() => setMode('view')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'view' ? 'bg-white text-emerald-900 shadow-md scale-105' : 'text-emerald-200 hover:text-white'}`}
          >
            <MousePointer2 size={16} /> الإدارة والبيانات
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'edit' ? 'bg-white text-emerald-900 shadow-md scale-105' : 'text-emerald-200 hover:text-white'}`}
          >
            <LayoutGrid size={16} /> تخطيط المزرعة
          </button>
        </div>

        {/* دليل الألوان (يتغير حسب الوضع) */}
        <div className="hidden lg:flex items-center gap-4">
          {mode === 'view' ? (
            <div className="flex gap-4 text-sm bg-emerald-800 p-2 rounded-lg border border-emerald-700">
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#059669]"></span> سليمة</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#d97706]"></span> {statusLabel(STATUS_NEEDS_PRUNING)}</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#dc2626]"></span> مصابة</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: 'conic-gradient(from 40deg, #dc2626 0 30%, #d97706 30% 100%)' }}></span> {statusLabel(STATUS_NEEDS_PRUNING)} + مصابة</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border border-emerald-600" style={{ background: TONE_COLORS.black }}></span> {STATUS_GRAFTED} / {STATUS_UPROOTED}</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400"></span> فارغة</div>
            </div>
          ) : (
            <div className="flex gap-4 text-sm bg-emerald-800 p-2 rounded-lg border border-emerald-700">
              <div className="flex items-center gap-1"><Droplet size={14} className="text-blue-400" /> مروى</div>
              <div className="flex items-center gap-1"><Waves size={14} className="text-stone-400" /> مصرف</div>
              <div className="flex items-center gap-1"><Route size={14} className="text-stone-300" /> طريق</div>
              <div className="flex items-center gap-1"><Leaf size={14} className="text-emerald-400" /> شجرة</div>
              <div className="flex items-center gap-1"><span>🛢️</span> حوض رش</div>
              <div className="flex items-center gap-1"><span>📍</span> عنصر مخصص</div>
            </div>
          )}
        </div>

        <div
          title={syncStatus === 'offline'
            ? 'غير متصل — التغييرات محفوظة محلياً وستتم المزامنة عند عودة الإنترنت'
            : syncStatus === 'syncing'
              ? 'جاري المزامنة'
              : syncStatus === 'error'
                ? 'مشكلة في المزامنة'
                : 'تمت المزامنة'}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-full border ${
            syncStatus === 'offline'
              ? 'bg-amber-100/10 border-amber-300/30 text-amber-100'
              : syncStatus === 'syncing'
                ? 'bg-sky-100/10 border-sky-300/30 text-sky-100'
                : syncStatus === 'error'
                  ? 'bg-red-100/10 border-red-300/30 text-red-100'
                  : 'bg-emerald-100/10 border-emerald-300/30 text-emerald-100'
          }`}
        >
          {syncStatus === 'offline' && <WifiOff size={13} />}
          {syncStatus === 'syncing' && <RefreshCw size={13} className="animate-spin" />}
          {syncStatus === 'error' && <AlertCircle size={13} />}
          {syncStatus === 'synced' && <CheckCircle2 size={13} />}
          <span>{syncStatus === 'offline' ? 'غير متصل — محفوظ محلياً' : syncStatus === 'syncing' ? 'جاري المزامنة' : syncStatus === 'error' ? 'مشكلة في المزامنة' : 'تمت المزامنة'}</span>
        </div>

        {user && 'uid' in user && user.uid !== 'local-user' && (
          <button
            type="button"
            onClick={handleLogout}
            title="تسجيل الخروج"
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-emerald-700 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-full transition-colors"
          >
            <LogOut size={13} />
            تسجيل الخروج
          </button>
        )}
      </header>
      </div>
      </div>

      {/* التنبيهات والأخطاء */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 shadow-sm z-20 flex justify-between items-center">
          <p className="m-0 font-medium">{error}</p>
          <button onClick={() => setError('')}><X size={18} /></button>
        </div>
      )}

      {/* شريط أدوات وضع التخطيط: تنبيه + إضافة صف/عمود + إعادة تعيين */}
      {mode === 'edit' && (
        <div className="bg-amber-100 text-amber-900 px-4 py-2 shadow-sm z-10 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">⚠️ أنت الآن في وضع التخطيط: اضغط على أي مساحة لاختيار نوعها من القائمة</span>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowAddMenu((v) => !v)}
                className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              >
                <Plus size={14} /> إضافة
              </button>
              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute top-full mt-1 left-0 z-50 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden min-w-[140px]">
                    <button
                      onClick={() => { setShowAddMenu(false); addRow(); }}
                      className="w-full text-right px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-emerald-50 transition-colors"
                    >
                      + صف جديد
                    </button>
                    <button
                      onClick={() => { setShowAddMenu(false); addColumn(); }}
                      className="w-full text-right px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-emerald-50 transition-colors border-t border-gray-100"
                    >
                      + عمود جديد
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* اتجاه الخريطة: اختيار مباشر (وليس قلباً إضافياً). يعكس الأشجار والطرق والمصارف والعناصر والتسميات معاً. */}
            <div className="flex items-center gap-1.5" role="group" aria-label="اتجاه الخريطة" data-testid="orientation-control">
              <span className="text-xs font-bold text-amber-900 whitespace-nowrap">اتجاه الخريطة:</span>
              <div className="flex bg-white/70 border border-amber-300 rounded-lg overflow-hidden">
                {ORIENTATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-orientation={opt.value}
                    aria-pressed={orientation === opt.value}
                    title={opt.english}
                    onClick={() => persistFarmState(
                      cellsData, rowsCount, colsCount, undefined, undefined, undefined, undefined,
                      landmarks, landmarkTypes, opt.value,
                    )}
                    className={`px-2.5 py-1.5 text-xs font-bold transition-colors border-l border-amber-200 first:border-l-0 ${
                      orientation === opt.value ? 'bg-emerald-700 text-white' : 'text-amber-900 hover:bg-amber-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* قائمة العناصر: أنواع العناصر + وضع أي عدد منها + العناصر الموضوعة */}
            <button
              type="button"
              data-testid="open-palette"
              onClick={() => { setShowPalette(true); setSelectedLandmarkId(null); }}
              aria-haspopup="dialog"
              className="flex items-center gap-1 bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
            >
              <span aria-hidden="true">📍</span> قائمة العناصر ({totalPlaced})
            </button>

            <div className="relative">
              <button
                onClick={() => setShowColNumberMenu((v) => !v)}
                className="flex items-center gap-1 bg-stone-600 hover:bg-stone-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              >
                <Hash size={14} /> ترقيم الأعمدة
              </button>
              {showColNumberMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColNumberMenu(false)} />
                  <div className="absolute top-full mt-1 left-0 z-50 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden w-[250px] max-h-[55vh] overflow-y-auto">
                    <div className="px-3 py-2 bg-stone-50 border-b border-gray-200 text-xs text-gray-600 leading-relaxed">
                      فعّل «بدون رقم» لأي عمود طريق/مصرف. العمود التالي يأخذ رقم العمود المحذوف ويكمل الترقيم. تنبيه: تغيير هذا الخيار يعيد ترقيم الأعمدة التي بعده (بيانات الأشجار لا تتغير).
                    </div>
                    {Array.from({ length: colsCount }, (_, colIndex) => {
                      const isUnlabeled = unlabeledCols.includes(colIndex);
                      const kind = colGapKinds[colIndex] || 'gap';
                      return (
                        <div key={`col-number-${colIndex + 1}`} className="border-b border-gray-100 last:border-b-0">
                          <button
                            onClick={() => toggleColNumber(colIndex)}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-emerald-50"
                          >
                            <span>العمود {colIndex + 1}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${isUnlabeled ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {isUnlabeled ? 'بدون رقم' : `رقم ${displayColLabels[colIndex]}`}
                            </span>
                          </button>
                          {isUnlabeled && (
                            <div className="px-3 pb-2 grid grid-cols-3 gap-1">
                              {([['road', 'طريق'], ['drainage', 'مصرف'], ['gap', 'فراغ']] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setColGapKind(colIndex, value)}
                                  className={`px-2 py-1 rounded text-[11px] font-bold border ${kind === value ? 'bg-stone-700 text-white border-stone-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-stone-50'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setShowRowNumberMenu((v) => !v)}
                className="flex items-center gap-1 bg-stone-700 hover:bg-stone-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              >
                <Hash size={14} /> ترقيم الصفوف
              </button>
              {showRowNumberMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowRowNumberMenu(false)} />
                  <div className="absolute top-full mt-1 left-0 z-50 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden w-[250px] max-h-[55vh] overflow-y-auto">
                    <div className="px-3 py-2 bg-stone-50 border-b border-gray-200 text-xs text-gray-600 leading-relaxed">
                      فعّل «بدون رقم» لأي صف طريق/مصرف. الصف التالي يأخذ رقم الصف المحذوف ويكمل الترقيم. تنبيه: تغيير هذا الخيار يعيد ترقيم الصفوف التي بعده (بيانات الأشجار لا تتغير).
                    </div>
                    {rowLabels.map((rowLetter, rowIndex) => {
                      const isUnlabeled = unlabeledRows.includes(rowIndex);
                      const kind = rowGapKinds[rowIndex] || 'gap';
                      return (
                        <div key={`row-number-${rowLetter}`} className="border-b border-gray-100 last:border-b-0">
                          <button
                            onClick={() => toggleRowNumber(rowIndex)}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-emerald-50"
                          >
                            <span>الصف {rowIndex + 1}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${isUnlabeled ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {isUnlabeled ? 'بدون رقم' : `رقم ${displayRowLabels[rowIndex]}`}
                            </span>
                          </button>
                          {isUnlabeled && (
                            <div className="px-3 pb-2 grid grid-cols-3 gap-1">
                              {([['road', 'طريق'], ['drainage', 'مصرف'], ['gap', 'فراغ']] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setRowGapKind(rowIndex, value)}
                                  className={`px-2 py-1 rounded text-[11px] font-bold border ${kind === value ? 'bg-stone-700 text-white border-stone-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-stone-50'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
            >
              <Trash2 size={14} /> إعادة تعيين المزرعة
            </button>
          </div>
        </div>
      )}

      {/* منطقة الخريطة */}
      <main className="flex-1 relative overflow-hidden bg-[#e4e0ce]">

        {/* مقبض إظهار الشريط العلوي (جوال فقط، يظهر عندما يكون الشريط مخفياً) */}
        <button
          type="button"
          className="farm-header-handle"
          data-visible={headerCollapsed ? 'true' : undefined}
          tabIndex={headerCollapsed ? 0 : -1}
          aria-label="إظهار الشريط العلوي"
          onClick={() => applyHeaderHidden(false, true)}
        >
          <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" focusable="false">
            <path d="M2 2l7 6 7-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* أزرار الزووم */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-white p-2 rounded-lg shadow-md border border-gray-200">
          <button onClick={zoomInBtn} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="تكبير">
            <ZoomIn size={20} />
          </button>
          <div className="w-full h-px bg-gray-200 my-1"></div>
          <button onClick={zoomOutBtn} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="تصغير">
            <ZoomOut size={20} />
          </button>
          <div className="w-full h-px bg-gray-200 my-1"></div>
          <button onClick={resetView} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="إعادة ضبط الرؤية">
            <Maximize size={20} />
          </button>
          <RealisticToolbarButtons mode={realistic} />
        </div>

        <RealisticOverlays mode={realistic} />

        {/* دليل الرموز: الأصناف وحالات الشجرة والبنية التحتية */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-start gap-2" dir="rtl">
          {showLegend && (
            <div className="farm-legend-panel" role="dialog" aria-label="دليل الرموز">
              <div className="farm-legend-title">حالة الشجرة</div>
              <div className="farm-legend-grid">
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: '#059669' }} />سليمة</span>
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: '#d97706' }} />{statusLabel(STATUS_NEEDS_PRUNING)}</span>
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: '#dc2626' }} />مصابة</span>
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: 'conic-gradient(from 40deg, #dc2626 0 30%, #d97706 30% 100%)' }} />{statusLabel(STATUS_NEEDS_PRUNING)} + مصابة</span>
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: TONE_COLORS.black }} />{STATUS_GRAFTED}</span>
                <span className="farm-legend-item"><i className="farm-legend-dot" style={{ background: TONE_COLORS.black }} />{STATUS_UPROOTED}</span>
              </div>
              <div className="farm-legend-title">الصنف (علامة صغيرة على الشجرة)</div>
              <div className="farm-legend-grid">
                {VARIETY_ACCENTS.map((a) => (
                  <span key={a.variety} className="farm-legend-item">
                    <i className="farm-legend-fruit" style={{ background: a.color }} />{a.variety}
                  </span>
                ))}
              </div>
              <div className="farm-legend-title">البنية التحتية</div>
              <div className="farm-legend-grid">
                <span className="farm-legend-item"><i className="farm-legend-swatch" style={{ background: '#4fa3c6' }} />مروى</span>
                <span className="farm-legend-item"><i className="farm-legend-swatch" style={{ background: '#cdbf9f' }} />طريق</span>
                <span className="farm-legend-item"><i className="farm-legend-swatch" style={{ background: '#667874' }} />مصرف</span>
                <span className="farm-legend-item"><span aria-hidden="true">🛢️</span>حوض رش</span>
              </div>
              {inventory.some((t) => t.count > 0) && (
                <>
                  <div className="farm-legend-title">العناصر المخصصة</div>
                  <div className="farm-legend-grid">
                    {inventory.filter((t) => t.count > 0).map((t) => (
                      <span key={t.id} className="farm-legend-item" title={t.name}>
                        <span aria-hidden="true">{t.icon}</span>
                        <span className="truncate">{t.name} ({t.count})</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowLegend((v) => !v)}
            aria-expanded={showLegend}
            className="farm-legend-btn"
          >
            دليل الرموز
          </button>
        </div>

        {/* لوحة العمل (Canvas) — تحكم موحّد بالفأرة واللمس عبر Pointer Events */}
        <div
          ref={containerRef}
          className={`farm-map-canvas w-full h-full touch-none ${mode === 'edit' ? 'farm-map-edit' : ''}`} style={{ direction: 'ltr' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {realistic.mounted && (
            <RealisticLayer
              quality={realistic.quality}
              options={realistic.options}
              visible={realistic.active}
              rows={rowsCount}
              cols={colsCount}
              rowLabels={rowLabels}
              cells={cellsData}
              orientation={orientation}
              displayKindGrid={displayKindGrid}
              kindGrid={kindGrid}
              rowGapKinds={rowGapKinds}
              colGapKinds={colGapKinds}
              landmarks={landmarks}
              gridOrigin={gridOrigin}
              containerRef={containerRef}
              landRef={landRef}
              getView={getRealisticView}
              viewListenerRef={realisticViewListenerRef}
              onProgress={realistic.onProgress}
              onReady={realistic.onReady}
              onError={realistic.onError}
              onSlow={realistic.onSlow}
            />
          )}
          <div
            ref={panZoomRef}
            style={{ transformOrigin: '0 0' }}
            className="absolute left-0 top-0 inline-block p-16"
          >
            {/* أرضية المزرعة والشبكة */}
            <div
              ref={landRef}
              className={`farm-land${realistic.active ? ' farm-realistic' : ''}${realistic.active && !realistic.options.showNumbers ? ' farm-rl-no-numbers' : ''}`}
              data-orientation={orientation}
              style={{
                display: 'grid',
                // The label column sits on the right when mirrored left<->right.
                gridTemplateColumns: flipX
                  ? `repeat(${colsCount}, ${GRID.cellW}px) ${GRID.labelColW}px`
                  : `${GRID.labelColW}px repeat(${colsCount}, ${GRID.cellW}px)`,
                gridAutoRows: `${GRID.cellH}px`,
                gap: `${GRID.gap}px`,
                padding: `${GRID.pad}px`,
              }}
            >
              {/* Both are absolutely positioned, so they take no grid cell. The
                  overlay is first in DOM order so trees/cells paint above it. */}
              <TreeSymbols />
              <InfrastructureLayer grid={displayKindGrid} origin={gridOrigin} />
              {/* Edit mode: ONE dashed-cell pattern instead of an outline on every cell. */}
              {mode === 'edit' && <EditGridOverlay rows={rowsCount} cols={colsCount} origin={gridOrigin} />}
              {/* Landmarks: their own layer on the same origin. Not grid cells, so no tree is displaced. */}
              <LandmarkLayer
                landmarks={landmarks}
                rows={rowsCount}
                cols={colsCount}
                orientation={orientation}
                origin={gridOrigin}
                selectedId={highlightedLandmarkId}
                conflictIds={landmarkConflictIds}
                placing={session !== null}
                kindGrid={kindGrid}
                movingId={session?.kind === 'move' ? session.landmarkId : null}
              />
              {gridCells}
            </div>
          </div>
        </div>
      </main>

      <RealisticConfirmDialog mode={realistic} />


      {/* منتقي نوع الخلية — يظهر بجانب نقطة الضغط في وضع التخطيط */}
      {typePicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTypePicker(null)} />
          <div
            className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 flex gap-1"
            style={{
              left: Math.min(Math.max(typePicker.x - 100, 8), (typeof window !== 'undefined' ? window.innerWidth : 400) - 208),
              top: Math.min(Math.max(typePicker.y - 80, 8), (typeof window !== 'undefined' ? window.innerHeight : 800) - 80),
            }}
          >
            {CELL_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => chooseTypeForCell(opt.type)}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg hover:bg-emerald-50 active:bg-emerald-100 transition-colors min-w-[44px]"
              >
                <span className="text-xl leading-none">{opt.emoji}</span>
                <span className="text-[10px] font-bold text-gray-600 whitespace-nowrap">{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* نافذة بيانات الشجرة */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">

            <div className="bg-emerald-800 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Leaf size={20} />
                تعديل الشجرة: <span dir="auto" className="tabular-nums">{selectedTreeCoordinate}</span>
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-emerald-100 hover:text-white transition-colors p-1 rounded-full hover:bg-emerald-600"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveTreeData} className="p-6 flex flex-col gap-5">

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                    <Info size={14} className="text-emerald-600" /> صنف المانجو
                  </label>
                  <select
                    value={formData.variety}
                    onChange={(e) => setFormData({ ...formData, variety: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {MANGO_VARIETIES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                    <AlertTriangle size={14} className="text-amber-500" /> الحالة العامة
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {TREE_STATUS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  <Bug size={14} className="text-red-500" /> الأمراض / الآفات
                </label>
                <select
                  value={formData.disease}
                  onChange={(e) => setFormData({ ...formData, disease: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-500 outline-none"
                >
                  {DISEASES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  <Droplet size={14} className="text-blue-500" /> تاريخ آخر تقليم
                </label>
                <input
                  type="date"
                  value={formData.pruneDate}
                  onChange={(e) => setFormData({ ...formData, pruneDate: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">ملاحظات إضافية</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="اكتب أي ملاحظات هنا..."
                  className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                />
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <Save size={18} />
                  حفظ البيانات
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-xl transition-colors border border-gray-300"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* قائمة العناصر، شريط الوضع المتكرر، تفاصيل عنصر واحد، وتأكيد حذفه */}
      {showPalette && (
        <LandmarkPalette
          inventory={inventory}
          placed={placedItems}
          onPick={startPlacing}
          onCreateType={handleCreateType}
          onDeleteType={handleDeleteType}
          onOpenLandmark={(id) => { setShowPalette(false); setConfirmDeleteLandmark(false); setSelectedLandmarkId(id); }}
          onClose={() => setShowPalette(false)}
        />
      )}
      {session && (
        <PlacementBar
          mode={session.kind}
          icon={session.kind === 'place' ? sessionType?.icon ?? '📍' : sessionLandmark?.icon ?? '📍'}
          name={session.kind === 'place' ? sessionType?.name ?? '' : sessionLandmark?.name ?? ''}
          placedNow={session.kind === 'place' ? session.placedIds.length : 0}
          total={session.kind === 'place' ? sessionType?.count ?? 0 : 0}
          message={placeMessage}
          canUndo={session.kind === 'place' && session.placedIds.length > 0}
          onUndo={undoLastPlacement}
          onChangeType={() => { endSession(); setShowPalette(true); }}
          onDone={endSession}
        />
      )}
      {selectedLandmark && !session && (
        <LandmarkDetailsDialog
          key={selectedLandmark.id}
          landmark={selectedLandmark}
          inventory={inventory}
          typeKey={landmarkTypeKey(selectedLandmark)}
          where={describeLandmarkSlot(selectedLandmark.position)}
          conflict={landmarkConflictIds.has(selectedLandmark.id)}
          onSave={saveLandmarkDetails}
          onMove={() => { setSession({ kind: 'move', landmarkId: selectedLandmark.id }); setPlaceMessage(null); }}
          onDelete={() => setConfirmDeleteLandmark(true)}
          onClose={() => { setSelectedLandmarkId(null); setConfirmDeleteLandmark(false); }}
        />
      )}
      {selectedLandmark && confirmDeleteLandmark && (
        <DeleteLandmarkConfirm
          landmark={selectedLandmark}
          where={describeLandmarkSlot(selectedLandmark.position)}
          onConfirm={confirmDeleteSelectedLandmark}
          onCancel={() => setConfirmDeleteLandmark(false)}
        />
      )}

      {/* تأكيد إعادة تعيين المزرعة بالكامل (إجراء لا يمكن التراجع عنه) */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={22} />
                <h2 className="text-lg font-bold text-gray-800 m-0">إعادة تعيين المزرعة بالكامل؟</h2>
              </div>
              <p className="text-sm text-gray-600 m-0 leading-relaxed">
                هيتم مسح كل بيانات الأشجار والمروى والمصرف والطرق نهائياً، ومفيش رجوع بعد كده.
                حجم الشبكة (عدد الصفوف والأعمدة الحالي) هيفضل زي ما هو.
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={resetFarm}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-xl transition-colors"
                >
                  نعم، امسح كل شيء
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 px-4 rounded-xl transition-colors border border-gray-300"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
