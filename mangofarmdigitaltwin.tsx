import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, ZoomIn, ZoomOut, Maximize, Save, X, Info, AlertTriangle, Bug, Droplet, Leaf, LayoutGrid, MousePointer2, Waves, Road } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "mock-key", authDomain: "mock-domain", projectId: "mock-project",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'mango-farm-app';

const COLS_COUNT = 60;
const ROWS_ALPHABET = [
  'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 
  'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 
  'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي', 'أأ', 'بب'
];

const MANGO_VARIETIES = ['غير محدد', 'عويس', 'فونس', 'كيت', 'نعومي', 'زبدية', 'تيمور', 'أخرى'];
const TREE_STATUS = ['سليمة', 'تحتاج تقليم', 'مصابة بآفة/مرض'];
const DISEASES = ['لا يوجد', 'عفن هبابي', 'ذبابة الفاكهة', 'تشوه زهري', 'أخرى'];

// 1. شجرة المانجو
const MangoTreeSVG = ({ fill, isDiseased, isEmpty }) => {
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
      <g fill={fill}>
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
    <path d="M -10 30 Q 25 15 50 30 T 110 30" fill="none" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" opacity="0.6"/>
    <path d="M -10 70 Q 25 55 50 70 T 110 70" fill="none" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" opacity="0.6"/>
  </svg>
);

// 3. المصرف (Drainage)
const DrainageSVG = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-95">
    <rect width="100" height="100" fill="#78716c" /> {/* حواف ترابية داكنة */}
    <rect x="25" y="0" width="50" height="100" fill="#292524" /> {/* عمق المصرف */}
    <line x1="25" y1="0" x2="25" y2="100" stroke="#1c1917" strokeWidth="4" />
    <line x1="75" y1="0" x2="75" y2="100" stroke="#1c1917" strokeWidth="4" />
    <path d="M 40 0 L 40 100 M 60 0 L 60 100" stroke="#44403c" strokeWidth="2" strokeDasharray="10 5" opacity="0.5"/>
  </svg>
);

// 4. طريق (Road)
const RoadSVG = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full rounded shadow-sm opacity-90">
    <rect width="100" height="100" fill="#d6d3d1" /> {/* لون الطريق الترابي/الممهد */}
    {/* آثار إطارات السيارات أو الخطوط الجانبية */}
    <line x1="30" y1="0" x2="30" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
    <line x1="70" y1="0" x2="70" y2="100" stroke="#a8a29e" strokeWidth="6" strokeDasharray="12 8" opacity="0.6" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [cellsData, setCellsData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // أوضاع التطبيق: 'view' (لإدارة الأشجار) | 'edit' (لتخطيط المزرعة والممرات)
  const [mode, setMode] = useState('view');

  const [selectedTree, setSelectedTree] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({});

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const dragDistance = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
        setError("مشكلة في تسجيل الدخول لقاعدة البيانات.");
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'farm_data', 'gridState');

    setLoading(true);
    const unsubscribe = onSnapshot(docRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          setCellsData(docSnap.data().cells || {});
        } else {
          setCellsData({});
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firestore error:", err);
        setError("فشل في مزامنة البيانات.");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [user]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setScale((prevScale) => Math.min(Math.max(0.15, prevScale * zoomFactor), 3));
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    dragDistance.current = 0;
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      dragDistance.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  const resetView = () => { setScale(1); setPosition({ x: 0, y: 0 }); };
  const zoomIn = () => setScale(prev => Math.min(prev * 1.2, 3));
  const zoomOut = () => setScale(prev => Math.max(prev / 1.2, 0.15));

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  const handleCellClick = async (cellId) => {
    if (dragDistance.current > 5) return; // تمييز السحب عن الضغط

    const cellData = cellsData[cellId] || { type: 'tree' };
    const currentType = cellData.type || 'tree';

    if (mode === 'edit') {
      // وضع التخطيط: تبديل نوع الخلية
      const types = ['tree', 'water_canal', 'drainage', 'road'];
      const nextIndex = (types.indexOf(currentType) + 1) % types.length;
      const nextType = types[nextIndex];

      const updatedCells = {
        ...cellsData,
        [cellId]: { ...cellData, type: nextType }
      };
      
      // التحديث المحلي الفوري لسرعة الاستجابة
      setCellsData(updatedCells);

      // الحفظ في قاعدة البيانات
      if (user) {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'farm_data', 'gridState');
        try {
          await setDoc(docRef, { cells: updatedCells }, { merge: true });
        } catch (err) {
          console.error("Failed to save layout", err);
        }
      }
    } else {
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
    }
  };

  const handleSaveTreeData = async (e) => {
    e.preventDefault();
    if (!user) { alert("يجب تسجيل الدخول لحفظ البيانات"); return; }

    try {
      const existingCellData = cellsData[selectedTree] || { type: 'tree' };
      const updatedCells = {
        ...cellsData,
        [selectedTree]: { ...existingCellData, ...formData, type: 'tree', lastUpdated: new Date().toISOString() }
      };
      setCellsData(updatedCells);
      setIsModalOpen(false);

      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'farm_data', 'gridState');
      await setDoc(docRef, { cells: updatedCells }, { merge: true });
    } catch (err) {
      setError("حدث خطأ أثناء الحفظ.");
    }
  };

  const getTreeStatusData = (data) => {
    if (!data) return { color: null, isEmpty: true, isDiseased: false, icon: null };
    
    const isDiseased = data.status === 'مصابة بآفة/مرض' || (data.disease && data.disease !== 'لا يوجد');
    
    if (isDiseased) {
      return { color: '#dc2626', isEmpty: false, isDiseased: true, icon: <Bug size={12}/>, iconColor: 'text-red-600' };
    }
    if (data.status === 'تحتاج تقليم') {
      return { color: '#d97706', isEmpty: false, isDiseased: false, icon: <AlertTriangle size={12}/>, iconColor: 'text-amber-600' };
    }
    return { color: '#059669', isEmpty: false, isDiseased: false, icon: <Leaf size={12}/>, iconColor: 'text-emerald-600' };
  };

  const renderCellContent = (cellId) => {
    const data = cellsData[cellId] || { type: 'tree' };
    const type = data.type || 'tree';

    if (type === 'water_canal') return <WaterCanalSVG />;
    if (type === 'drainage') return <DrainageSVG />;
    if (type === 'road') return <RoadSVG />;
    
    // Default Tree Render
    const statusData = getTreeStatusData(data);
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

  if (loading && !Object.keys(cellsData).length) {
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
            <h1 className="text-xl font-bold m-0 leading-tight">التوأم الرقمي للمزرعة</h1>
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
              <div className="flex items-center gap-1"><Droplet size={14} className="text-blue-400"/> مروى</div>
              <div className="flex items-center gap-1"><Waves size={14} className="text-stone-400"/> مصرف</div>
              <div className="flex items-center gap-1"><Road size={14} className="text-stone-300"/> طريق</div>
              <div className="flex items-center gap-1"><Leaf size={14} className="text-emerald-400"/> شجرة</div>
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
          ⚠️ أنت الآن في وضع التخطيط: اضغط على أي مساحة لتغيير نوعها (شجرة ⬅️ مروى ⬅️ مصرف ⬅️ طريق)
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
          className={`w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div 
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: '0 0',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
            className="inline-block p-16"
          >
            {/* أرضية المزرعة والشبكة */}
            <div 
              className="bg-[#f0eadd] p-6 rounded-xl shadow-2xl border-[6px] border-[#d4c5a9]"
              style={{
                display: 'grid',
                gridTemplateColumns: `50px repeat(${COLS_COUNT}, 55px)`,
                gridAutoRows: '65px',
                gap: '4px', // تقليل المسافة لتلاصق الطرق والمصارف
              }}
            >
              {/* صف الأرقام العلوي */}
              <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] shadow-inner mb-2">
                #
              </div>
              {[...Array(COLS_COUNT)].map((_, colIndex) => (
                <div key={`header-${colIndex}`} className="bg-[#e6ddca] rounded flex items-center justify-center font-bold text-[#5c4e36] text-sm mb-2 shadow-sm">
                  {colIndex + 1}
                </div>
              ))}

              {/* صفوف المزرعة */}
              {ROWS_ALPHABET.map((rowLetter) => (
                <React.Fragment key={rowLetter}>
                  {/* حرف الصف */}
                  <div className="bg-[#d4c5a9] rounded flex items-center justify-center font-bold text-[#5c4e36] text-lg sticky right-0 z-10 shadow-sm">
                    {rowLetter}
                  </div>
                  
                  {/* مساحات/خلايا الصف */}
                  {[...Array(COLS_COUNT)].map((_, colIndex) => {
                    const cellId = `${rowLetter}-${colIndex + 1}`;
                    const cellType = (cellsData[cellId] && cellsData[cellId].type) ? cellsData[cellId].type : 'tree';

                    return (
                      <div 
                        key={cellId}
                        onMouseUp={() => handleCellClick(cellId)}
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
                    <Info size={14} className="text-emerald-600"/> صنف المانجو
                  </label>
                  <select 
                    value={formData.variety}
                    onChange={(e) => setFormData({...formData, variety: e.target.value})}
                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {MANGO_VARIETIES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                    <AlertTriangle size={14} className="text-amber-500"/> الحالة العامة
                  </label>
                  <select 
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value})}
                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {TREE_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  <Bug size={14} className="text-red-500"/> الأمراض / الآفات
                </label>
                <select 
                  value={formData.disease}
                  onChange={(e) => setFormData({...formData, disease: e.target.value})}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-500 outline-none"
                >
                  {DISEASES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  <Droplet size={14} className="text-blue-500"/> تاريخ آخر تقليم
                </label>
                <input 
                  type="date" 
                  value={formData.pruneDate}
                  onChange={(e) => setFormData({...formData, pruneDate: e.target.value})}
                  className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">ملاحظات إضافية</label>
                <textarea 
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  rows="3" 
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