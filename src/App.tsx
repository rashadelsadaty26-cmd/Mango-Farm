import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Save, X, Info, AlertTriangle, Bug,
  Droplet, Leaf, LayoutGrid, MousePointer2, Waves, Route, Cloud, HardDrive, Plus, Trash2,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, onAuthStateChanged, type Auth, type User,
} from 'firebase/auth';
import {
  getFirestore, doc, setDoc, onSnapshot, type Firestore,
} from 'firebase/firestore';

// ============================================================================
// الإعدادات والتخزين: يعمل التطبيق محلياً (localStorage) افتراضياً بدون أي
// إعداد، ولو تم ضبط متغيرات بيئة Firebase (VITE_FIREBASE_*) في Vercel يتحول
// تلقائياً للمزامنة السحابية. لا حاجة لتعديل الكود عند إضافة Firebase لاحقاً.
// ============================================================================
const STORAGE_KEY = 'mango_farm_grid_state_v1';
const APP_ID = (import.meta.env.VITE_APP_ID as string) || 'mango-farm-app';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let auth: Auth | undefined;
let db: Firestore | undefined;
if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
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

const MANGO_VARIETIES = ['غير محدد', 'عويس', 'فونس', 'كيت', 'نعومي', 'زبدية', 'تيمور', 'أخرى'];
const TREE_STATUS = ['سليمة', 'تحتاج تقليم', 'مصابة بآفة/مرض'];
const DISEASES = ['لا يوجد', 'عفن هبابي', 'ذبابة الفاكهة', 'تشوه زهري', 'أخرى'];

type CellType = 'tree' | 'water_canal' | 'drainage' | 'road';

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

type Connections = { up: boolean; down: boolean; left: boolean; right: boolean };

const CELL_TYPE_OPTIONS: { type: CellType; emoji: string; label: string }[] = [
  { type: 'tree', emoji: '🌳', label: 'شجرة' },
  { type: 'water_canal', emoji: '💧', label: 'مروى' },
  { type: 'drainage', emoji: '🕳️', label: 'مصرف' },
  { type: 'road', emoji: '🛣️', label: 'طريق' },
];

// ---- مساعد: إيجاد رقم خلية الجار في اتجاه معيّن (لأغراض ربط رسومات المصرف) ----
function getNeighborId(
  cellId: string,
  dir: 'up' | 'down' | 'left' | 'right',
  rowLabels: string[],
  colsCount: number
): string | null {
  const dashIdx = cellId.lastIndexOf('-');
  const rowLabel = cellId.slice(0, dashIdx);
  const col = parseInt(cellId.slice(dashIdx + 1), 10);
  const rowIdx = rowLabels.indexOf(rowLabel);
  if (rowIdx === -1 || Number.isNaN(col)) return null;

  let newRowIdx = rowIdx;
  let newCol = col;
  if (dir === 'up') newRowIdx -= 1;
  else if (dir === 'down') newRowIdx += 1;
  else if (dir === 'left') newCol -= 1;
  else if (dir === 'right') newCol += 1;

  if (newRowIdx < 0 || newRowIdx >= rowLabels.length || newCol < 1 || newCol > colsCount) return null;
  return `${rowLabels[newRowIdx]}-${newCol}`;
}

function getConnections(
  cellId: string,
  type: CellType,
  cellsData: CellsData,
  rowLabels: string[],
  colsCount: number
): Connections {
  const dirs: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
  const result: Connections = { up: false, down: false, left: false, right: false };
  for (const dir of dirs) {
    const neighborId = getNeighborId(cellId, dir, rowLabels, colsCount);
    if (neighborId && cellsData[neighborId]?.type === type) {
      result[dir] = true;
    }
  }
  return result;
}

// 1. شجرة المانجو
const MangoTreeSVG = ({ fill, isDiseased, isEmpty }: { fill?: string | null; isDiseased?: boolean; isEmpty?: boolean }) => {
  if (isEmpty) {
    return (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm opacity-60">
        <ellipse cx="50" cy="90" rx="20" ry="4" fill="rgba(0,0,0,0.05)" />
        <path d="M50 90 L50 50" stroke="#9ca3af" strokeWidth="4" strokeLinecap="round" />
        <path d="M50 70 L35 55" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" />
        <circle cx="50" cy="45" r="8" fill="#d1d5db" />
        <circle cx="32" cy="52" r="5" fill="#d1d5db" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
      <ellipse cx="50" cy="95" rx="25" ry="5" fill="rgba(0,0,0,0.15)" />
      <path d="M45 95 C 45 75, 42 60, 42 50 L 58 50 C 58 60, 55 75, 55 95 Z" fill="#78350f" />
      <g fill={fill || '#059669'}>
        <circle cx="50" cy="30" r="28" />
        <circle cx="28" cy="50" r="25" />
        <circle cx="72" cy="50" r="25" />
        <circle cx="38" cy="68" r="22" />
        <circle cx="62" cy="68" r="22" />
        <circle cx="50" cy="50" r="26" />
      </g>
      <g fill="rgba(255,255,255,0.15)">
        <circle cx="40" cy="25" r="12" />
        <circle cx="22" cy="45" r="10" />
      </g>
      <g fill="rgba(0,0,0,0.1)">
        <circle cx="60" cy="70" r="15" />
        <circle cx="75" cy="55" r="12" />
      </g>
      {isDiseased && (
        <g fill="#450a0a" opacity="0.6">
          <circle cx="45" cy="35" r="3" />
          <circle cx="60" cy="40" r="4" />
          <circle cx="35" cy="55" r="3" />
          <circle cx="70" cy="50" r="3.5" />
          <circle cx="50" cy="60" r="4" />
          <circle cx="25" cy="50" r="2.5" />
        </g>
      )}
    </svg>
  );
};

// الأنواع الثلاثة التالية (مروى/مصرف/طريق) كلها "متصلة" بنفس المبدأ: كل خلية
// تتحقق من جيرانها (فوق/تحت/يمين/شمال) من نفس النوع فقط، وتمتد نحوهم تلقائياً
// بدل تكرار نفس الرمز المنفصل في كل خلية — فتظهر كشبكة واحدة متصلة.

// 2. المروى (Water Canal) — بروز اللون الأزرق الغامق (القناة) نحو كل جار متصل،
// وما تبقى يظهر بلون أفتح (ضفة المروى) في الاتجاهات غير المتصلة.
const ConnectedWaterCanalSVG = ({ connections }: { connections: Connections }) => {
  const { up, down, left, right } = connections;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-90">
      <rect width="100" height="100" fill="#bfdbfe" />
      <rect x="25" y="25" width="50" height="50" fill="#3b82f6" />
      {up && <rect x="25" y="0" width="50" height="25" fill="#3b82f6" />}
      {down && <rect x="25" y="75" width="50" height="25" fill="#3b82f6" />}
      {left && <rect x="0" y="25" width="25" height="50" fill="#3b82f6" />}
      {right && <rect x="75" y="25" width="25" height="50" fill="#3b82f6" />}
      <path d="M -10 30 Q 25 15 50 30 T 110 30" fill="none" stroke="#93c5fd" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <path d="M -10 70 Q 25 55 50 70 T 110 70" fill="none" stroke="#93c5fd" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
};

// 3. المصرف (Drainage) — مربع مركزي ثابت + امتداد (بروز) نحو كل اتجاه متصل.
const ConnectedDrainageSVG = ({ connections }: { connections: Connections }) => {
  const { up, down, left, right } = connections;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-95">
      <rect width="100" height="100" fill="#78716c" />
      <rect x="25" y="25" width="50" height="50" fill="#292524" />
      {up && <rect x="25" y="0" width="50" height="25" fill="#292524" />}
      {down && <rect x="25" y="75" width="50" height="25" fill="#292524" />}
      {left && <rect x="0" y="25" width="25" height="50" fill="#292524" />}
      {right && <rect x="75" y="25" width="25" height="50" fill="#292524" />}
    </svg>
  );
};

// 4. طريق (Road) — الرصفة نفسها موحّدة اللون دايماً (كانت كده أصلاً)، لكن خطوط
// تقسيم المسار (الداشات) دلوقتي بتتجه أفقياً أو رأسياً حسب الجيران المتصلين
// بدل اتجاه رأسي ثابت كان بيقطع أي طريق أفقي بخطوط غلط.
const ConnectedRoadSVG = ({ connections }: { connections: Connections }) => {
  const { up, down, left, right } = connections;
  const vertical = up || down;
  const horizontal = left || right;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-90">
      <rect width="100" height="100" fill="#d6d3d1" />
      {vertical && (
        <>
          <line x1="30" y1="0" x2="30" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
          <line x1="70" y1="0" x2="70" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
        </>
      )}
      {horizontal && (
        <>
          <line x1="0" y1="30" x2="100" y2="30" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
          <line x1="0" y1="70" x2="100" y2="70" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
        </>
      )}
      {!vertical && !horizontal && <circle cx="50" cy="50" r="8" fill="#a8a29e" opacity="0.4" />}
    </svg>
  );
};

export default function App() {
  const [user, setUser] = useState<User | { uid: string } | null>(null);
  const [cellsData, setCellsData] = useState<CellsData>({});
  const [rowsCount, setRowsCount] = useState(DEFAULT_ROWS);
  const [colsCount, setColsCount] = useState(DEFAULT_COLS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const [isDragging, setIsDragging] = useState(false);

  const rowLabels = React.useMemo(
    () => Array.from({ length: rowsCount }, (_, i) => getRowLabel(i)),
    [rowsCount]
  );

  // ---- تحريك وتكبير/تصغير: كل شيء عبر refs + تعديل مباشر لخاصية transform في
  // الـ DOM، بدون أي setState أثناء السحب أو الزووم، حتى لا تُعاد رسمة الشبكة
  // كاملة (قد تصل لآلاف الخلايا) في كل حركة فأر/إصبع — هذا هو سبب الإحساس
  // بالبطء/الصعوبة سابقاً على الديسكتوب، وهو ما كان سيصبح أسوأ على الموبايل.
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const panZoomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const applyTransform = () => {
    if (panZoomRef.current) {
      panZoomRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px) scale(${scaleRef.current})`;
    }
  };

  const clampScale = (s: number) => Math.min(Math.max(0.15, s), 3);

  // تكبير/تصغير مع تثبيت النقطة الموجودة تحت المؤشر/الإصبع في مكانها (بدل
  // التكبير دائماً من زاوية الشبكة العلوية، وهو ما كان يسبب "قفز" المحتوى).
  const zoomAtPoint = useCallback((clientX: number, clientY: number, newScaleRaw: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const newScale = clampScale(newScaleRaw);
    const contentX = (px - posRef.current.x) / scaleRef.current;
    const contentY = (py - posRef.current.y) / scaleRef.current;
    posRef.current = { x: px - contentX * newScale, y: py - contentY * newScale };
    scaleRef.current = newScale;
    applyTransform();
  }, []);

  const resetView = () => {
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    applyTransform();
  };

  const zoomInBtn = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleRef.current * 1.2);
  };

  const zoomOutBtn = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleRef.current / 1.2);
  };

  // ---- عجلة الفأرة/التراك باد: زووم سلس ومتناسب مع سرعة التمرير الفعلية ----
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAtPoint(e.clientX, e.clientY, scaleRef.current * factor);
  }, [zoomAtPoint]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // ---- تحميل البيانات عند بدء التشغيل: Firebase لو متاح، وإلا محلياً ----
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          setCellsData(parsed.cells || {});
          setRowsCount(parsed.rowsCount || DEFAULT_ROWS);
          setColsCount(parsed.colsCount || DEFAULT_COLS);
        } else {
          setCellsData({});
        }
      } catch (err) {
        console.error('Failed to read local storage', err);
        setError('تعذر قراءة البيانات المحفوظة محلياً.');
      }
      setUser({ uid: 'local-user' });
      setLoading(false);
      return;
    }

    const initAuth = async () => {
      try {
        await signInAnonymously(auth as Auth);
      } catch (err) {
        console.error('Auth error:', err);
        setError('مشكلة في تسجيل الدخول لقاعدة البيانات السحابية.');
        setLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // ---- المزامنة الحية من Firestore (لو Firebase مفعّل فقط) ----
  useEffect(() => {
    if (!isFirebaseConfigured || !db || !user || !('uid' in user) || user.uid === 'local-user') return;

    const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'farm_data', 'gridState');

    setLoading(true);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCellsData(data.cells || {});
          setRowsCount(data.rowsCount || DEFAULT_ROWS);
          setColsCount(data.colsCount || DEFAULT_COLS);
        } else {
          setCellsData({});
        }
        setLoading(false);
      },
      (err) => {
        console.error('Firestore error:', err);
        setError('فشل في مزامنة البيانات مع السحابة.');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [user]);

  // ---- حفظ موحّد للخلايا وأبعاد الشبكة: يكتب للسحابة لو متاحة، وإلا محلياً ----
  const persistFarmState = useCallback(async (nextCells: CellsData, nextRows: number, nextCols: number) => {
    setCellsData(nextCells);
    setRowsCount(nextRows);
    setColsCount(nextCols);

    const payload = { cells: nextCells, rowsCount: nextRows, colsCount: nextCols };

    if (isFirebaseConfigured && db && user && 'uid' in user && user.uid !== 'local-user') {
      const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'farm_data', 'gridState');
      try {
        await setDoc(docRef, payload, { merge: true });
      } catch (err) {
        console.error('Failed to save to Firestore, falling back to local copy', err);
        setError('تعذر الحفظ على السحابة، تم حفظ نسخة محلية مؤقتاً.');
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch { /* تجاهل */ }
      }
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.error('Failed to save locally', err);
        setError('تعذر حفظ البيانات محلياً (قد تكون مساحة التخزين ممتلئة).');
      }
    }
  }, [user]);

  const addRow = () => persistFarmState(cellsData, rowsCount + 1, colsCount);
  const addColumn = () => persistFarmState(cellsData, rowsCount, colsCount + 1);

  // إعادة تعيين المزرعة بالكامل: مسح كل بيانات الخلايا (أشجار/مروى/مصرف/طريق)
  // مع الإبقاء على حجم الشبكة الحالي (عدد الصفوف/الأعمدة) كما هو — قرار مقصود:
  // "reset" هنا يعني مسح البيانات لا تصغير الشبكة اللي وسّعتها بنفسك.
  const resetFarm = () => {
    setShowResetConfirm(false);
    persistFarmState({}, rowsCount, colsCount);
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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* بعض المتصفحات لا تدعمها بالكامل */ }

    const wasEmpty = pointers.current.size === 0;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (wasEmpty) {
      dragDistance.current = 0;
      pinchOccurred.current = false;
    }

    if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
      pinchStart.current = null;
      setIsDragging(true);
    } else if (pointers.current.size === 2) {
      const pts = getPointsArray();
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStart.current = { distance: Math.hypot(dx, dy) || 1, scale: scaleRef.current };
      panStart.current = null;
      pinchOccurred.current = true;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    dragDistance.current += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1 && panStart.current) {
      posRef.current = { x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y };
      applyTransform();
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
      // إصبع واحد باقٍ بعد إنهاء pinch: نكمل تحريك سلس من غير قفزة
      const remaining = getPointsArray()[0];
      panStart.current = { x: remaining.x - posRef.current.x, y: remaining.y - posRef.current.y };
      pinchStart.current = null;
    } else if (pointers.current.size === 0) {
      setIsDragging(false);
      panStart.current = null;
      pinchStart.current = null;

      if (isTapCandidate && !pinchOccurred.current && dragDistance.current < 10) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
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

  const getTreeStatusData = (data: CellData | null) => {
    if (!data) return { color: null as string | null, isEmpty: true, isDiseased: false, icon: null as React.ReactNode, iconColor: '' };

    const isDiseased = data.status === 'مصابة بآفة/مرض' || (!!data.disease && data.disease !== 'لا يوجد');

    if (isDiseased) {
      return { color: '#dc2626', isEmpty: false, isDiseased: true, icon: <Bug size={12} />, iconColor: 'text-red-600' };
    }
    if (data.status === 'تحتاج تقليم') {
      return { color: '#d97706', isEmpty: false, isDiseased: false, icon: <AlertTriangle size={12} />, iconColor: 'text-amber-600' };
    }
    return { color: '#059669', isEmpty: false, isDiseased: false, icon: <Leaf size={12} />, iconColor: 'text-emerald-600' };
  };

  const renderCellContent = (cellId: string) => {
    const data = cellsData[cellId];
    const type = data?.type || 'tree';

    if (type === 'water_canal') {
      const connections = getConnections(cellId, 'water_canal', cellsData, rowLabels, colsCount);
      return <ConnectedWaterCanalSVG connections={connections} />;
    }
    if (type === 'drainage') {
      const connections = getConnections(cellId, 'drainage', cellsData, rowLabels, colsCount);
      return <ConnectedDrainageSVG connections={connections} />;
    }
    if (type === 'road') {
      const connections = getConnections(cellId, 'road', cellsData, rowLabels, colsCount);
      return <ConnectedRoadSVG connections={connections} />;
    }

    // مساحة الشجرة: تُعتبر "مُدخلة" فقط لو المستخدم حفظ بياناتها فعلاً
    // (وجود lastUpdated)، وإلا تظهر كموقع فارغ لم يُدخل بعد (تصحيح لعرض كانت
    // فيه كل المساحات تظهر "سليمة" افتراضياً حتى لو لم تُسجَّل أي بيانات).
    const isConfigured = !!data?.lastUpdated;
    const statusData = getTreeStatusData(isConfigured ? data! : null);

    return (
      <div className={`relative w-full h-full flex flex-col items-center justify-end transition-transform duration-200 ease-out ${mode === 'view' ? 'hover:scale-125 hover:-translate-y-2 hover:z-20' : 'hover:scale-110'}`}>
        {!statusData.isEmpty && (
          <div className={`absolute top-0 right-1 p-0.5 rounded-full bg-white shadow-md z-10 border border-gray-200 ${statusData.iconColor}`}>
            {statusData.icon}
          </div>
        )}
        <div className="w-full h-[85%]">
          <MangoTreeSVG fill={statusData.color} isDiseased={statusData.isDiseased} isEmpty={statusData.isEmpty} />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50" dir="rtl">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-600"></div>
        <span className="mr-3 text-emerald-800 font-semibold text-lg">جاري تحميل الخريطة...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans overflow-hidden" dir="rtl">

      {/* شريط العنوان وأدوات التحكم في الوضع */}
      <header className="bg-emerald-900 text-white p-4 shadow-md flex flex-wrap gap-4 justify-between items-center z-20 relative">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg text-emerald-800">
            <Leaf size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold m-0 leading-tight">التوأم الرقمي للمزرعة</h1>
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
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#d97706]"></span> تقليم</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#dc2626]"></span> مصابة</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400"></span> فارغة</div>
            </div>
          ) : (
            <div className="flex gap-4 text-sm bg-emerald-800 p-2 rounded-lg border border-emerald-700">
              <div className="flex items-center gap-1"><Droplet size={14} className="text-blue-400" /> مروى</div>
              <div className="flex items-center gap-1"><Waves size={14} className="text-stone-400" /> مصرف</div>
              <div className="flex items-center gap-1"><Route size={14} className="text-stone-300" /> طريق</div>
              <div className="flex items-center gap-1"><Leaf size={14} className="text-emerald-400" /> شجرة</div>
            </div>
          )}
        </div>
      </header>

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

          <div className="flex items-center gap-2">
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
      <main className="flex-1 relative overflow-hidden bg-[#faf8f5]" style={{ backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', backgroundSize: '30px 30px' }}>

        {/* أزرار الزووم */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 bg-white/90 backdrop-blur p-2 rounded-lg shadow-lg border border-gray-200">
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
        </div>

        {/* لوحة العمل (Canvas) — تحكم موحّد بالفأرة واللمس عبر Pointer Events */}
        <div
          ref={containerRef}
          className={`w-full h-full touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <div
            ref={panZoomRef}
            style={{ transformOrigin: '0 0' }}
            className="inline-block p-16"
          >
            {/* أرضية المزرعة والشبكة */}
            <div
              className="bg-[#f0eadd] p-6 rounded-xl shadow-2xl border-[6px] border-[#d4c5a9]"
              style={{
                display: 'grid',
                gridTemplateColumns: `50px repeat(${colsCount}, 55px)`,
                gridAutoRows: '65px',
                gap: '4px',
              }}
            >
              {/* صف الأرقام العلوي */}
              <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] shadow-inner mb-2">
                #
              </div>
              {[...Array(colsCount)].map((_, colIndex) => (
                <div key={`header-${colIndex}`} className="bg-[#e6ddca] rounded flex items-center justify-center font-bold text-[#5c4e36] text-sm mb-2 shadow-sm">
                  {colIndex + 1}
                </div>
              ))}

              {/* صفوف المزرعة */}
              {rowLabels.map((rowLetter) => (
                <React.Fragment key={rowLetter}>
                  {/* حرف الصف */}
                  <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] text-lg sticky right-0 z-10 shadow-sm">
                    {rowLetter}
                  </div>

                  {/* مساحات/خلايا الصف */}
                  {[...Array(colsCount)].map((_, colIndex) => {
                    const cellId = `${rowLetter}-${colIndex + 1}`;
                    const cellType = cellsData[cellId]?.type || 'tree';

                    return (
                      <div
                        key={cellId}
                        data-cell-id={cellId}
                        className={`relative w-full h-full flex items-center justify-center rounded-sm ${mode === 'edit' ? 'cursor-pointer hover:bg-white/30' : (cellType === 'tree' ? 'cursor-pointer' : 'cursor-default')}`}
                        title={mode === 'edit' ? `تعديل: ${cellId}` : (cellType === 'tree' ? `شجرة ${cellId}` : '')}
                      >
                        {renderCellContent(cellId)}

                        {/* رقم تعريف المساحة */}
                        <span className="absolute -bottom-1 bg-white/90 border border-gray-200 px-1 rounded-[3px] text-[8px] font-bold text-gray-700 shadow-sm pointer-events-none z-10">
                          {cellId}
                        </span>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </main>


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
                تعديل الشجرة: {selectedTree}
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
                    {TREE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
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
