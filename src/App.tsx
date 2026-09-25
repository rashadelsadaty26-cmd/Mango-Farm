import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Save, X, Info, AlertTriangle, Bug,
  Droplet, Leaf, LayoutGrid, MousePointer2, Waves, Route, Cloud, HardDrive,
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

const COLS_COUNT = 60;
const ROWS_ALPHABET = [
  'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر',
  'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف',
  'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي', 'أأ', 'بب',
];

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

// 2. المروى (Water Canal)
const WaterCanalSVG = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-90">
    <rect width="100" height="100" fill="#3b82f6" />
    <path d="M -10 30 Q 25 15 50 30 T 110 30" fill="none" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
    <path d="M -10 70 Q 25 55 50 70 T 110 70" fill="none" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
  </svg>
);

// 3. المصرف (Drainage): شكل متصل تلقائياً مع الخلايا المجاورة.
const DrainageSVG = ({
  north,
  east,
  south,
  west,
}: {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}) => {
  const hasConnection = north || east || south || west;

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-95 overflow-visible">
      <rect width="100" height="100" rx="5" fill="#78716c" />

      {!hasConnection ? (
        <>
          <rect x="37" y="7" width="26" height="86" rx="7" fill="#292524" />
          <path d="M50 12 Q45 20 50 28 T50 44 T50 60 T50 76 T50 88" fill="none" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" opacity="0.72" />
        </>
      ) : (
        <>
          {north && <rect x="38" y="-4" width="24" height="54" fill="#292524" />}
          {south && <rect x="38" y="50" width="24" height="54" fill="#292524" />}
          {west && <rect x="-4" y="38" width="54" height="24" fill="#292524" />}
          {east && <rect x="50" y="38" width="54" height="24" fill="#292524" />}
          <rect x="38" y="38" width="24" height="24" rx="8" fill="#292524" />

          {north && <line x1="50" y1="2" x2="50" y2="50" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" opacity="0.72" />}
          {south && <line x1="50" y1="50" x2="50" y2="98" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" opacity="0.72" />}
          {west && <line x1="2" y1="50" x2="50" y2="50" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" opacity="0.72" />}
          {east && <line x1="50" y1="50" x2="98" y2="50" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" opacity="0.72" />}
          <circle cx="50" cy="50" r="5" fill="#93c5fd" opacity="0.82" />
        </>
      )}
    </svg>
  );
};

// 4. طريق (Road)
const RoadSVG = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-90">
    <rect width="100" height="100" fill="#d6d3d1" />
    <line x1="30" y1="0" x2="30" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
    <line x1="70" y1="0" x2="70" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState<User | { uid: string } | null>(null);
  const [cellsData, setCellsData] = useState<CellsData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // أوضاع التطبيق: 'view' (لإدارة الأشجار) | 'edit' (لتخطيط المزرعة والممرات)
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const [selectedTree, setSelectedTree] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<CellData>({});

  const [rowCount, setRowCount] = useState(ROWS_ALPHABET.length);
  const [colCount, setColCount] = useState(COLS_COUNT);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [placementCellId, setPlacementCellId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef({ x: 0, y: 0 });
  const interactionMovedRef = useRef(false);
  const pinchStartRef = useRef<{
    distance: number;
    scale: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  // ---- تحميل البيانات عند بدء التشغيل: Firebase لو متاح، وإلا محلياً ----
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      // وضع التخزين المحلي: لا حاجة لتسجيل دخول
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object' && 'cells' in parsed) {
            setCellsData(parsed.cells || {});
            setRowCount(Number(parsed.layout?.rows) || ROWS_ALPHABET.length);
            setColCount(Number(parsed.layout?.cols) || COLS_COUNT);
          } else {
            // توافق مع النسخ القديمة التي كانت تحفظ cellsData مباشرة.
            setCellsData(parsed || {});
            setRowCount(ROWS_ALPHABET.length);
            setColCount(COLS_COUNT);
          }
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
        const snapshotData = docSnap.exists() ? docSnap.data() : {};
        setCellsData(snapshotData.cells || {});
        setRowCount(Number(snapshotData.layout?.rows) || ROWS_ALPHABET.length);
        setColCount(Number(snapshotData.layout?.cols) || COLS_COUNT);
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

  // ---- حفظ موحّد: يكتب للسحابة لو متاحة، وإلا محلياً ----
  const persistCells = useCallback(async (
    updatedCells: CellsData,
    nextRowCount = rowCount,
    nextColCount = colCount,
  ) => {
    setCellsData(updatedCells);
    setRowCount(nextRowCount);
    setColCount(nextColCount);

    const farmState = {
      cells: updatedCells,
      layout: {
        rows: nextRowCount,
        cols: nextColCount,
      },
    };

    if (isFirebaseConfigured && db && user && 'uid' in user && user.uid !== 'local-user') {
      const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'farm_data', 'gridState');
      try {
        await setDoc(docRef, farmState, { merge: true });
      } catch (err) {
        console.error('Failed to save to Firestore, falling back to local copy', err);
        setError('تعذر الحفظ على السحابة، تم حفظ نسخة محلية مؤقتاً.');
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(farmState));
        } catch { /* تجاهل */ }
      }
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(farmState));
      } catch (err) {
        console.error('Failed to save locally', err);
        setError('تعذر حفظ البيانات محلياً (قد تكون مساحة التخزين ممتلئة).');
      }
    }
  }, [user, rowCount, colCount]);

  const clampScale = (value: number) => Math.min(Math.max(value, 0.15), 3);

  const getRowLabel = (index: number) =>
    index < ROWS_ALPHABET.length ? ROWS_ALPHABET[index] : `صف ${index + 1}`;

  const rowLabels = Array.from({ length: rowCount }, (_, index) => getRowLabel(index));

  const getDrainageConnections = (rowIndex: number, colIndex: number) => ({
    north: rowIndex > 0 && cellsData[`${getRowLabel(rowIndex - 1)}-${colIndex + 1}`]?.type === 'drainage',
    east: colIndex < colCount - 1 && cellsData[`${getRowLabel(rowIndex)}-${colIndex + 2}`]?.type === 'drainage',
    south: rowIndex < rowCount - 1 && cellsData[`${getRowLabel(rowIndex + 1)}-${colIndex + 1}`]?.type === 'drainage',
    west: colIndex > 0 && cellsData[`${getRowLabel(rowIndex)}-${colIndex}`]?.type === 'drainage',
  });

  const addRow = async () => {
    setPlacementCellId(null);
    await persistCells(cellsData, rowCount + 1, colCount);
  };

  const addColumn = async () => {
    setPlacementCellId(null);
    await persistCells(cellsData, rowCount, colCount + 1);
  };

  const zoomAtPoint = useCallback((factor: number, clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) {
      setScale((prev) => clampScale(prev * factor));
      return;
    }

    const rect = container.getBoundingClientRect();
    const point = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };

    setScale((prevScale) => {
      const nextScale = clampScale(prevScale * factor);
      const worldX = (point.x - position.x) / prevScale;
      const worldY = (point.y - position.y) / prevScale;

      setPosition({
        x: point.x - worldX * nextScale,
        y: point.y - worldY * nextScale,
      });

      return nextScale;
    });
  }, [position]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    // Trackpads emit small deltas; exponential scaling keeps both wheel and
    // trackpad zoom smooth instead of jumping by a fixed 10% each event.
    const normalizedDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.min(Math.max(Math.exp(-normalizedDelta * 0.0012), 0.82), 1.22);
    zoomAtPoint(factor, e.clientX, e.clientY);
  }, [zoomAtPoint]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const container = containerRef.current;
    if (container) {
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers can reject capture during rapid pointer changes.
      }
    }

    const rect = container?.getBoundingClientRect();
    const point = {
      x: e.clientX - (rect?.left || 0),
      y: e.clientY - (rect?.top || 0),
    };

    const pointers = activePointersRef.current;
    pointers.set(e.pointerId, point);
    interactionMovedRef.current = false;

    if (pointers.size === 1) {
      dragStartRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      pinchStartRef.current = null;
      setIsDragging(true);
      return;
    }

    if (pointers.size === 2) {
      // Once two fingers are down, this interaction must never be treated as a cell click.
      interactionMovedRef.current = true;

      const [first, second] = Array.from(pointers.values());
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };

      pinchStartRef.current = {
        distance,
        scale,
        worldX: (midpoint.x - position.x) / scale,
        worldY: (midpoint.y - position.y) / scale,
      };
      setIsDragging(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = activePointersRef.current;
    if (!pointers.has(e.pointerId)) return;

    const rect = containerRef.current?.getBoundingClientRect();
    pointers.set(e.pointerId, {
      x: e.clientX - (rect?.left || 0),
      y: e.clientY - (rect?.top || 0),
    });

    if (pointers.size >= 2 && pinchStartRef.current) {
      const [first, second] = Array.from(pointers.values());
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const pinch = pinchStartRef.current;
      const nextScale = clampScale(pinch.scale * (distance / pinch.distance));

      setPosition({
        x: midpoint.x - pinch.worldX * nextScale,
        y: midpoint.y - pinch.worldY * nextScale,
      });
      setScale(nextScale);
      interactionMovedRef.current = true;
      return;
    }

    if (pointers.size === 1 && !pinchStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x - position.x;
      const dy = e.clientY - dragStartRef.current.y - position.y;

      if (Math.abs(dx) + Math.abs(dy) > 2) {
        interactionMovedRef.current = true;
      }

      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = activePointersRef.current;

    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore pointer-capture cleanup errors.
    }

    pointers.delete(e.pointerId);

    if (pointers.size === 1) {
      const [remainingId, remainingPoint] = Array.from(pointers.entries())[0];
      const rect = containerRef.current?.getBoundingClientRect();
      const remainingClientX = remainingPoint.x + (rect?.left || 0);
      const remainingClientY = remainingPoint.y + (rect?.top || 0);

      dragStartRef.current = {
        x: remainingClientX - position.x,
        y: remainingClientY - position.y,
      };
      pinchStartRef.current = null;
      setIsDragging(true);
      return;
    }

    pinchStartRef.current = null;
    setIsDragging(false);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    pinchStartRef.current = null;
    setIsDragging(false);
    interactionMovedRef.current = true;
  };

  const resetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const zoomIn = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setScale((prev) => clampScale(prev * 1.2));
      return;
    }
    zoomAtPoint(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const zoomOut = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setScale((prev) => clampScale(prev / 1.2));
      return;
    }
    zoomAtPoint(1 / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  const handleCellClick = (cellId: string) => {
    if (interactionMovedRef.current) return;

    const cellData: CellData = cellsData[cellId] || { type: 'tree' };
    const currentType = cellData.type || 'tree';

    if (mode === 'edit') {
      setPlacementCellId(cellId);
      return;
    }

    // وضع الإدارة: فتح بيانات الأشجار فقط
    if (currentType === 'tree') {
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

  const handlePlaceCellType = async (type: CellType) => {
    if (!placementCellId) return;

    const cellData: CellData = cellsData[placementCellId] || { type: 'tree' };
    const updatedCells: CellsData = {
      ...cellsData,
      [placementCellId]: {
        ...cellData,
        type,
      },
    };

    setPlacementCellId(null);
    await persistCells(updatedCells);
  };
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
      await persistCells(updatedCells);
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء الحفظ.');
    }
  };

  const getTreeStatusData = (data: CellData | null) => {
    if (!data) return { color: null as string | null, isEmpty: true, isDiseased: false, icon: null as React.ReactNode };

    const isDiseased = data.status === 'مصابة بآفة/مرض' || (!!data.disease && data.disease !== 'لا يوجد');

    if (isDiseased) {
      return { color: '#dc2626', isEmpty: false, isDiseased: true, icon: <Bug size={12} />, iconColor: 'text-red-600' };
    }
    if (data.status === 'تحتاج تقليم') {
      return { color: '#d97706', isEmpty: false, isDiseased: false, icon: <AlertTriangle size={12} />, iconColor: 'text-amber-600' };
    }
    return { color: '#059669', isEmpty: false, isDiseased: false, icon: <Leaf size={12} />, iconColor: 'text-emerald-600' };
  };

  const renderCellContent = (cellId: string, rowIndex: number, colIndex: number) => {
    const data = cellsData[cellId];
    const type = data?.type || 'tree';

    if (type === 'water_canal') return <WaterCanalSVG />;
    if (type === 'drainage') {
      const connections = getDrainageConnections(rowIndex, colIndex);
      return <DrainageSVG {...connections} />;
    }
    if (type === 'road') return <RoadSVG />;

    // مساحة الشجرة: تُعتبر "مزروعة/مُدخلة" فقط لو المستخدم حفظ بياناتها فعلاً.
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

  const placementOptions: {
    type: CellType;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    { type: 'tree', label: 'شجرة', icon: <Leaf size={22} />, description: 'موقع شجرة' },
    { type: 'water_canal', label: 'مروى', icon: <Droplet size={22} />, description: 'خط / مساحة مروية' },
    { type: 'drainage', label: 'مصرف', icon: <Waves size={22} />, description: 'مصرف متصل' },
    { type: 'road', label: 'طريق', icon: <Route size={22} />, description: 'طريق أو ممر' },
  ];
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
            onClick={() => { setMode('view'); setPlacementCellId(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'view' ? 'bg-white text-emerald-900 shadow-md scale-105' : 'text-emerald-200 hover:text-white'}`}
          >
            <MousePointer2 size={16} /> الإدارة والبيانات
          </button>
          <button
            onClick={() => { setMode('edit'); setPlacementCellId(null); }}
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

      {/* شريط الإشعارات لوضع التخطيط */}
      {mode === 'edit' && (
        <div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm text-center font-semibold shadow-sm z-10 border-b border-amber-200">
          ⚠️ أنت الآن في وضع التخطيط: اضغط على أي مساحة ثم اختر نوعها من القائمة.
        </div>
      )}

      {/* منطقة الخريطة */}
      <main className="flex-1 relative overflow-hidden bg-[#faf8f5]" style={{ backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', backgroundSize: '30px 30px' }}>

        {/* أزرار الزووم */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 bg-white/90 backdrop-blur p-2 rounded-lg shadow-lg border border-gray-200">
          <button onClick={zoomIn} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="تكبير">
            <ZoomIn size={20} />
          </button>
          <div className="w-full h-px bg-gray-200 my-1"></div>
          <button onClick={zoomOut} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="تصغير">
            <ZoomOut size={20} />
          </button>
          <div className="w-full h-px bg-gray-200 my-1"></div>
          <button onClick={resetView} className="p-2 hover:bg-emerald-50 rounded text-gray-700 hover:text-emerald-700 transition-colors" title="إعادة ضبط الرؤية">
            <Maximize size={20} />
          </button>
        </div>

        {/* لوحة العمل (Canvas) */}
        <div
          ref={containerRef}
          className={`farm-map-canvas w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <div
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: '0 0',
              transition: isDragging ? 'none' : 'transform 0.08s ease-out',
            }}
            className="inline-block p-16"
          >
            {/* أرضية المزرعة والشبكة */}
            <div
              className="bg-[#f0eadd] p-6 rounded-xl shadow-2xl border-[6px] border-[#d4c5a9]"
              style={{
                display: 'grid',
                gridTemplateColumns: `50px repeat(${colCount}, 55px) 76px`,
                gridAutoRows: '65px',
                gap: '4px',
              }}
            >
              {/* صف الأرقام العلوي */}
              <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] shadow-inner mb-2">
                #
              </div>
              {Array.from({ length: colCount }, (_, colIndex) => (
                <div key={`header-${colIndex}`} className="bg-[#e6ddca] rounded flex items-center justify-center font-bold text-[#5c4e36] text-sm mb-2 shadow-sm">
                  {colIndex + 1}
                </div>
              ))}
              <div className="bg-[#e6ddca] rounded flex items-center justify-center font-bold text-[#5c4e36] text-[10px] mb-2 shadow-sm">
                صف +
              </div>

              {/* صفوف المزرعة */}
              {rowLabels.map((rowLetter, rowIndex) => (
                <React.Fragment key={`${rowLetter}-${rowIndex}`}>
                  {/* حرف الصف */}
                  <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] text-lg sticky right-0 z-10 shadow-sm">
                    {rowLetter}
                  </div>

                  {/* مساحات/خلايا الصف */}
                  {Array.from({ length: colCount }, (_, colIndex) => {
                    const cellId = `${rowLetter}-${colIndex + 1}`;
                    const cellType = cellsData[cellId]?.type || 'tree';

                    return (
                      <div
                        key={cellId}
                        onClick={() => handleCellClick(cellId)}
                        className={`relative w-full h-full flex items-center justify-center rounded-sm select-none ${mode === 'edit' ? 'cursor-pointer hover:bg-white/30' : (cellType === 'tree' ? 'cursor-pointer' : 'cursor-default')}`}
                        title={mode === 'edit' ? `تعديل: ${cellId}` : (cellType === 'tree' ? `شجرة ${cellId}` : '')}
                      >
                        <div className="pointer-events-none w-full h-full">
                          {renderCellContent(cellId, rowIndex, colIndex)}
                        </div>

                        {/* رقم تعريف المساحة */}
                        <span className="absolute -bottom-1 bg-white/90 border border-gray-200 px-1 rounded-[3px] text-[8px] font-bold text-gray-700 shadow-sm pointer-events-none z-10">
                          {cellId}
                        </span>
                      </div>
                    );
                  })}

                  {/* إضافة صف */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addRow();
                    }}
                    className="rounded-md border border-[#c7b995] bg-[#e6ddca] text-[#5c4e36] hover:bg-white font-black text-lg shadow-sm transition-colors"
                    title="إضافة صف جديد"
                  >
                    +
                  </button>
                </React.Fragment>
              ))}

              {/* إضافة عمود */}
              <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] text-xs shadow-sm">
                عمود +
              </div>
              {Array.from({ length: colCount }, (_, colIndex) => (
                <button
                  key={`add-column-${colIndex}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    addColumn();
                  }}
                  className="rounded-md border border-[#c7b995] bg-[#e6ddca] text-[#5c4e36] hover:bg-white font-black text-lg shadow-sm transition-colors"
                  title={`إضافة عمود جديد بعد العمود ${colIndex + 1}`}
                >
                  +
                </button>
              ))}
              <div className="bg-[#d4c5a9] rounded" />
            </div>
          </div>
        </div>
      </main>

      {/* اختيار نوع المساحة في وضع التخطيط */}
      {placementCellId && mode === 'edit' && (
        <div className="fixed left-1/2 bottom-5 -translate-x-1/2 z-40 w-[min(92vw,520px)]">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 px-2 pb-2">
              <div>
                <div className="text-sm font-bold text-gray-800">اختيار نوع المساحة</div>
                <div className="text-xs text-gray-500">{placementCellId}</div>
              </div>
              <button
                type="button"
                onClick={() => setPlacementCellId(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {placementOptions.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => handlePlaceCellType(option.type)}
                  className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-2 text-gray-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 active:scale-[0.98] transition-all"
                >
                  {option.icon}
                  <span className="text-sm font-bold">{option.label}</span>
                  <span className="text-[10px] text-gray-400">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
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
    </div>
  );
}
