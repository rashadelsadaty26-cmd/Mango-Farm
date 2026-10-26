import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Filter, MapPin, RefreshCw, Search, Trees } from 'lucide-react';
import { getTreeHealthFlags, NO_DISEASE, STATUS_GRAFTED, STATUS_NEEDS_PRUNING, STATUS_UPROOTED, UNSPECIFIED_VARIETY, statusLabel } from '../farm/treeVisuals';
import { resolveInfraKind } from '../farm/infrastructure';

type FarmCell = {
  type?: string;
  variety?: string;
  status?: string;
  disease?: string;
  pruneDate?: string;
  notes?: string;
  lastUpdated?: string;
};
type FarmCells = Record<string, FarmCell | undefined>;
type SyncState = 'offline' | 'syncing' | 'synced' | 'error';
type HighlightKind = 'status' | 'variety' | 'weak' | 'diseased';

export interface AnalyticsHighlight { kind: HighlightKind; value: string; label: string }
interface Props {
  cells: FarmCells;
  rowLabels: string[];
  rowsCount: number;
  colsCount: number;
  unnumberedRows: number[];
  unnumberedCols: number[];
  rowGapKinds: Record<number, string>;
  colGapKinds: Record<number, string>;
  coordinateAt: (rowIndex: number, colIndex: number) => string | null;
  syncStatus: SyncState;
  error: string;
  dataUnavailable: boolean;
  onSelectTree: (cellId: string) => void;
  onHighlight: (highlight: AnalyticsHighlight) => void;
  onFilteredCellsChange: (cellIds: string[] | null) => void;
}
interface TreeRow {
  cellId: string; rowIndex: number; colIndex: number; coordinate: string; data: FarmCell; populated: boolean;
  status: string; variety: string; diseased: boolean; weak: boolean; grafted: boolean; uprooted: boolean;
}

function isTreeCell(data: FarmCell | undefined): boolean {
  return !data?.type || data.type === 'tree';
}
function hasSavedTreeData(data: FarmCell | undefined): boolean {
  if (!data) return false;
  // Older saved records may not have lastUpdated. Treat their actual tree fields as
  // evidence of a populated record instead of misclassifying them as empty sites.
  return [data.status, data.variety, data.disease, data.pruneDate, data.notes, data.lastUpdated]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
}
function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(rows: TreeRow[]) {
  const header = ['Cell ID', 'Coordinate', 'Status (stored)', 'Status (display)', 'Variety', 'Disease', 'Pruning date', 'Last updated', 'Notes'];
  const records = rows.map((row) => [row.cellId, row.coordinate, row.data.status || '', statusLabel(row.data.status), row.data.variety || '', row.data.disease || '', row.data.pruneDate || '', row.data.lastUpdated || '', row.data.notes || '']);
  const csv = '\ufeff' + [header, ...records].map((line) => line.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mango-farm-analytics.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export const FarmAnalytics = React.memo(function FarmAnalytics(props: Props) {
  const { cells, rowLabels, rowsCount, colsCount, unnumberedRows, unnumberedCols, rowGapKinds, colGapKinds, coordinateAt, syncStatus, error, dataUnavailable, onSelectTree, onHighlight, onFilteredCellsChange } = props;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [varietyFilter, setVarietyFilter] = useState('all');
  const [rowFilter, setRowFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'coordinate' | 'status' | 'variety' | 'lastUpdated'>('coordinate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const derived = useMemo(() => {
    const rows: TreeRow[] = [];
    let totalSlots = 0;
    let infrastructureCells = 0;
    const infra: Record<string, number> = { road: 0, water_canal: 0, drainage: 0, spray_tank: 0 };
    for (let r = 0; r < rowsCount; r++) {
      for (let c = 0; c < colsCount; c++) {
        const id = `${rowLabels[r]}-${c + 1}`;
        const data = cells[id];
        // Resolve infrastructure the same way as the map: explicit cell type first,
        // then the configured row/column corridor. These are derived counts only.
        const resolvedInfra = resolveInfraKind(data?.type, rowGapKinds[r], colGapKinds[c]);
        if (resolvedInfra === 'road' || resolvedInfra === 'water' || resolvedInfra === 'drainage') {
          infrastructureCells++;
          const infraKey = resolvedInfra === 'water' ? 'water_canal' : resolvedInfra;
          infra[infraKey] = (infra[infraKey] || 0) + 1;
          continue;
        }
        if (resolvedInfra === 'gap') continue;
        if (data?.type === 'spray_tank') {
          infrastructureCells++;
          infra.spray_tank++;
          continue;
        }
        if (!isTreeCell(data)) { infrastructureCells++; continue; }
        if (unnumberedRows.includes(r) || unnumberedCols.includes(c)) continue;
        totalSlots++;
        const flags = data ? getTreeHealthFlags(data) : { diseased: false, needsPruning: false, retired: null };
        const populated = hasSavedTreeData(data);
        rows.push({
          cellId: id, rowIndex: r, colIndex: c,
          coordinate: coordinateAt(r, c) || `صف ${r + 1} · عمود ${c + 1} (بدون رقم)`,
          data: data || {}, populated,
          status: populated ? (data?.status || 'حالة غير مسجلة') : 'فارغة',
          variety: populated ? (data?.variety || UNSPECIFIED_VARIETY) : 'غير مسجلة',
          diseased: flags.diseased,
          weak: flags.needsPruning,
          grafted: flags.retired === 'grafted' || data?.status === STATUS_GRAFTED,
          uprooted: flags.retired === 'uprooted' || data?.status === STATUS_UPROOTED,
        });
      }
    }
    const populatedRows = rows.filter((r) => r.populated);
    const statusCounts = new Map<string, number>();
    const varietyCounts = new Map<string, number>();
    for (const row of populatedRows) {
      statusCounts.set(row.status, (statusCounts.get(row.status) || 0) + 1);
      const variety = row.data.variety || UNSPECIFIED_VARIETY;
      varietyCounts.set(variety, (varietyCounts.get(variety) || 0) + 1);
    }
    const timestamps = populatedRows.map((r) => r.data.lastUpdated || '').filter(Boolean).sort();
    const latestTimestamp = timestamps.length ? timestamps[timestamps.length - 1] : '';
    const healthByRow = rowLabels.map((label, rowIndex) => {
      const rowTrees = populatedRows.filter((r) => r.rowIndex === rowIndex);
      return { label, rowIndex, total: rowTrees.length, weak: rowTrees.filter((r) => r.weak).length, diseased: rowTrees.filter((r) => r.diseased).length };
    }).filter((row) => row.total > 0);
    const missingStatus = populatedRows.filter((r) => !r.data.status).length;
    const missingVariety = populatedRows.filter((r) => !r.data.variety || r.data.variety === UNSPECIFIED_VARIETY).length;
    const missingRequired = populatedRows.filter((r) => !r.data.status || !r.data.variety || !r.data.lastUpdated).length;
    const alerts = populatedRows.map((row) => {
      const reasons: string[] = [];
      if (row.diseased) reasons.push('حالة مرض/آفة مسجلة');
      if (row.weak) reasons.push(`الحالة المخزنة: ${STATUS_NEEDS_PRUNING} (تعرض باسم «ضعيفة»)`);
      if (!row.data.status) reasons.push('الحالة غير مسجلة');
      if (!row.data.variety || row.data.variety === UNSPECIFIED_VARIETY) reasons.push('الصنف غير محدد');
      if (!row.data.lastUpdated) reasons.push('تاريخ الحفظ غير متاح');
      return { ...row, reasons, priority: row.diseased || row.weak ? 0 : 1 };
    }).filter((row) => row.reasons.length > 0)
      .sort((a, b) => a.priority - b.priority || a.coordinate.localeCompare(b.coordinate, 'ar'));
    return {
      rows, populatedRows, totalSlots, infrastructureCells, infra, alerts,
      emptyCount: Math.max(0, totalSlots - populatedRows.length),
      statusCounts: [...statusCounts.entries()].sort((a, b) => b[1] - a[1]),
      varietyCounts: [...varietyCounts.entries()].sort((a, b) => b[1] - a[1]),
      healthByRow,
      weak: populatedRows.filter((r) => r.weak), diseased: populatedRows.filter((r) => r.diseased),
      grafted: populatedRows.filter((r) => r.grafted), uprooted: populatedRows.filter((r) => r.uprooted),
      missingStatus, missingVariety, missingRequired, latestTimestamp,
    };
  }, [cells, rowLabels, rowsCount, colsCount, unnumberedRows, unnumberedCols, rowGapKinds, colGapKinds, coordinateAt]);

  const filteredRows = useMemo(() => {
    const rows = derived.rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (varietyFilter !== 'all' && row.variety !== varietyFilter) return false;
      if (rowFilter !== 'all' && row.rowIndex !== Number(rowFilter)) return false;
      const query = search.trim().toLocaleLowerCase();
      return !query || [row.cellId, row.coordinate, row.status, statusLabel(row.status), row.variety, row.data.disease, row.data.notes]
        .some((v) => String(v || '').toLocaleLowerCase().includes(query));
    });
    const sign = sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortBy === 'coordinate' ? a.coordinate : sortBy === 'status' ? statusLabel(a.status) : sortBy === 'variety' ? a.variety : (a.data.lastUpdated || '');
      const bv = sortBy === 'coordinate' ? b.coordinate : sortBy === 'status' ? statusLabel(b.status) : sortBy === 'variety' ? b.variety : (b.data.lastUpdated || '');
      return sign * String(av || '').localeCompare(String(bv || ''), 'ar', { numeric: true });
    });
    return rows;
  }, [derived.rows, statusFilter, varietyFilter, rowFilter, search, sortBy, sortDirection]);

  const query = search.trim().toLocaleLowerCase();
  const searchMatches = (row: TreeRow) => !query || [row.cellId, row.coordinate, row.status, statusLabel(row.status), row.variety, row.data.disease, row.data.notes]
    .some((v) => String(v || '').toLocaleLowerCase().includes(query));
  // Charts are cross-filtered: each chart honors the other dimensions but keeps
  // its own dimension available so the user can switch categories without reset.
  const statusChartRows = useMemo(() => derived.rows.filter((row) => row.populated &&
    (varietyFilter === 'all' || row.variety === varietyFilter) &&
    (rowFilter === 'all' || row.rowIndex === Number(rowFilter)) && searchMatches(row)),
  [derived.rows, varietyFilter, rowFilter, query]);
  const statusChartCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of statusChartRows) counts.set(row.status, (counts.get(row.status) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [statusChartRows]);
  const varietyChartRows = useMemo(() => derived.rows.filter((row) => row.populated &&
    (statusFilter === 'all' || row.status === statusFilter) &&
    (rowFilter === 'all' || row.rowIndex === Number(rowFilter)) && searchMatches(row)),
  [derived.rows, statusFilter, rowFilter, query]);
  const varietyChartCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of varietyChartRows) counts.set(row.variety, (counts.get(row.variety) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [varietyChartRows]);
  const rowHealthRows = useMemo(() => derived.rows.filter((row) => row.populated &&
    (statusFilter === 'all' || row.status === statusFilter) &&
    (varietyFilter === 'all' || row.variety === varietyFilter) && searchMatches(row)),
  [derived.rows, statusFilter, varietyFilter, query]);
  const filteredHealthByRow = useMemo(() => rowLabels.map((label, rowIndex) => {
    const trees = rowHealthRows.filter((row) => row.rowIndex === rowIndex);
    return { label, rowIndex, total: trees.length, weak: trees.filter((row) => row.weak).length, diseased: trees.filter((row) => row.diseased).length };
  }).filter((row) => row.total > 0), [rowLabels, rowHealthRows]);
  const selectedPopulatedRows = useMemo(() => filteredRows.filter((row) => row.populated), [filteredRows]);
  const selectedEmptyCount = Math.max(0, filteredRows.length - selectedPopulatedRows.length);
  const selectedWeak = selectedPopulatedRows.filter((row) => row.weak);
  const selectedDiseased = selectedPopulatedRows.filter((row) => row.diseased);
  const selectedGrafted = selectedPopulatedRows.filter((row) => row.grafted);
  const selectedUprooted = selectedPopulatedRows.filter((row) => row.uprooted);
  const selectedMissingRequired = selectedPopulatedRows.filter((row) => !row.data.status || !row.data.variety || !row.data.lastUpdated).length;
  const selectedTimestamps = selectedPopulatedRows.map((row) => row.data.lastUpdated || '').filter(Boolean).sort();
  const selectedLatestTimestamp = selectedTimestamps.length ? selectedTimestamps[selectedTimestamps.length - 1] : '';
  const visibleAlerts = useMemo(() => {
    const ids = new Set(filteredRows.map((row) => row.cellId));
    return derived.alerts.filter((row) => ids.has(row.cellId));
  }, [derived.alerts, filteredRows]);

  const hasActiveFilters = statusFilter !== 'all' || varietyFilter !== 'all' || rowFilter !== 'all' || !!search.trim();
  useEffect(() => {
    if (dataUnavailable || !hasActiveFilters) onFilteredCellsChange(null);
    else onFilteredCellsChange(filteredRows.map((row) => row.cellId));
  }, [dataUnavailable, hasActiveFilters, filteredRows, onFilteredCellsChange]);

  const maxStatus = Math.max(1, ...statusChartCounts.map(([, count]) => count));
  const maxVariety = Math.max(1, ...varietyChartCounts.map(([, count]) => count));
  const recordText = (count: number) => count.toLocaleString('en-US');
  const syncCopy = syncStatus === 'synced' ? 'تمت المزامنة' : syncStatus === 'syncing' ? 'جارٍ تحديث البيانات' : syncStatus === 'offline' ? 'بيانات محلية — قد تكون غير متزامنة' : 'تعذر التحقق من المزامنة';

  if (dataUnavailable) {
    return (
      <section className="farm-analytics-view" dir="rtl" aria-label="تحليلات المزرعة">
        <div className="farm-analytics-heading"><div><p className="farm-analytics-eyebrow"><BarChart3 size={15} /> لوحة مؤشرات المزرعة</p><h2>تحليلات المزرعة</h2><p>لا يمكن حساب مؤشرات موثوقة قبل التحقق من تحميل بيانات مزرعة هذا الحساب.</p></div><div className={`farm-analytics-sync farm-analytics-sync--${syncStatus}`}><span className="farm-analytics-sync-dot" />{syncCopy}</div></div>
        <div className="farm-analytics-warning"><AlertTriangle size={19} /><span>{error || 'بيانات المزرعة غير متاحة حالياً. قد يكون الاتصال مفقوداً أو لم تُحسم صلاحيات القراءة بعد.'} لم يتم إنشاء مزرعة فارغة تلقائياً، ولم يتم تعديل أي سجل محفوظ.</span></div>
        <article className="farm-analytics-card" style={{ maxWidth: 760, padding: 20 }}><h3>البيانات غير متاحة للتحليل</h3><p className="farm-analytics-bottom-note">اتصل بالإنترنت لإتاحة النسخة السحابية، أو تحقق من صلاحيات Firebase. إذا كانت هناك نسخة محلية صالحة فسيستخدمها التطبيق عند تحميلها.</p></article>
      </section>
    );
  }

  return (
    <section className="farm-analytics-view" dir="rtl" aria-label="تحليلات المزرعة">
      <div className="farm-analytics-heading">
        <div>
          <p className="farm-analytics-eyebrow"><BarChart3 size={15} /> لوحة مؤشرات المزرعة</p>
          <h2>تحليلات المزرعة</h2>
          <p>مؤشرات مشتقة من سجلات المزرعة المحمّلة حالياً؛ لا تُعدّل بيانات الأشجار أو البنية التحتية.</p>
        </div>
        <div className={`farm-analytics-sync farm-analytics-sync--${syncStatus}`}><span className="farm-analytics-sync-dot" />{syncCopy}</div>
      </div>

      {error && <div className="farm-analytics-warning"><AlertTriangle size={17} /><span>{error} — قد تكون بعض المؤشرات غير متاحة.</span></div>}

      <div className="farm-analytics-kpis">
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter('all'); setVarietyFilter('all'); setRowFilter('all'); }}>
          <span className="farm-analytics-kpi-icon"><Trees size={19} /></span><span className="farm-analytics-kpi-label">مواقع زراعة الأشجار</span><strong>{recordText(filteredRows.length)}</strong><small>مطابقة للمرشحات الحالية من {recordText(derived.totalSlots)} موقعاً</small>
        </button>
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter('all'); setSearch(''); }}>
          <span className="farm-analytics-kpi-icon farm-analytics-kpi-icon--green"><Trees size={19} /></span><span className="farm-analytics-kpi-label">أشجار ذات بيانات محفوظة</span><strong>{recordText(selectedPopulatedRows.length)}</strong><small>وفق حقول محفوظة في السجل المطابق</small>
        </button>
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter('فارغة'); setSearch(''); }}>
          <span className="farm-analytics-kpi-icon farm-analytics-kpi-icon--muted"><Filter size={18} /></span><span className="farm-analytics-kpi-label">مواقع خالية</span><strong>{recordText(selectedEmptyCount)}</strong><small>من النتائج المطابقة للمرشحات</small>
        </button>
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter(STATUS_NEEDS_PRUNING); setSearch(''); }}>
          <span className="farm-analytics-kpi-icon farm-analytics-kpi-icon--amber"><AlertTriangle size={18} /></span><span className="farm-analytics-kpi-label">ضعيفة / تحتاج متابعة</span><strong>{recordText(selectedWeak.length)}</strong><small>الحالة المخزنة: {STATUS_NEEDS_PRUNING}</small>
        </button>
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter(STATUS_GRAFTED); setSearch(''); }}>
          <span className="farm-analytics-kpi-icon"><Trees size={18} /></span><span className="farm-analytics-kpi-label">أشجار مطعّمة</span><strong>{recordText(selectedGrafted.length)}</strong><small>فئة مستقلة عن الأشجار المقلوعة</small>
        </button>
        <button className="farm-analytics-kpi" onClick={() => { setStatusFilter(STATUS_UPROOTED); setSearch(''); }}>
          <span className="farm-analytics-kpi-icon farm-analytics-kpi-icon--muted"><Trees size={18} /></span><span className="farm-analytics-kpi-label">أشجار مقلوعة</span><strong>{recordText(selectedUprooted.length)}</strong><small>الحالة المخزنة محفوظة كما هي</small>
        </button>
      </div>

      <div className="farm-analytics-grid">
        <article className="farm-analytics-card">
          <div className="farm-analytics-card-head"><div><h3>توزيع حالات الأشجار</h3><p>اضغط على فئة لتصفية الجدول</p></div></div>
          {statusChartCounts.length ? <div className="farm-analytics-bars">{statusChartCounts.map(([status, count]) => (
            <button key={status} className={`farm-analytics-bar-row ${statusFilter === status ? 'is-active' : ''}`} onClick={() => { setStatusFilter(status); setSearch(''); }}>
              <span className="farm-analytics-bar-label">{status === STATUS_NEEDS_PRUNING ? statusLabel(status) : status}</span><span className="farm-analytics-bar-track"><i style={{ width: `${(count / maxStatus) * 100}%` }} /></span><strong>{recordText(count)}</strong>
            </button>
          ))}</div> : <div className="farm-analytics-empty">لا توجد سجلات مطابقة لعرض توزيع الحالات.</div>}
          {statusChartCounts.length > 0 && statusFilter !== 'all' && <button className="farm-analytics-link" onClick={() => onHighlight({ kind: 'status', value: statusFilter, label: statusLabel(statusFilter) })}><MapPin size={15} /> تظليل هذه الحالة على خريطة المزرعة</button>}
        </article>

        <article className="farm-analytics-card">
          <div className="farm-analytics-card-head"><div><h3>توزيع الأصناف</h3><p>حسب الصنف المسجل في بيانات الشجرة</p></div></div>
          {varietyChartCounts.length ? <div className="farm-analytics-bars">{varietyChartCounts.map(([variety, count]) => (
            <button key={variety} className={`farm-analytics-bar-row ${varietyFilter === variety ? 'is-active' : ''}`} onClick={() => { setVarietyFilter(variety); setSearch(''); }}>
              <span className="farm-analytics-bar-label">{variety}</span><span className="farm-analytics-bar-track farm-analytics-bar-track--blue"><i style={{ width: `${(count / maxVariety) * 100}%` }} /></span><strong>{recordText(count)}</strong>
            </button>
          ))}</div> : <div className="farm-analytics-empty">لا توجد أصناف مطابقة للمرشحات الحالية.</div>}
          {varietyFilter !== 'all' && <button className="farm-analytics-link" onClick={() => onHighlight({ kind: 'variety', value: varietyFilter, label: varietyFilter })}><MapPin size={15} /> تظليل هذا الصنف على خريطة المزرعة</button>}
        </article>

        <article className="farm-analytics-card">
          <div className="farm-analytics-card-head"><div><h3>الصحة والمتابعة</h3><p>ملاحظات من البيانات المسجلة فقط</p></div></div>
          <div className="farm-analytics-stat-lines">
            <button onClick={() => { setStatusFilter('all'); setSearch(''); onHighlight({ kind: 'weak', value: 'weak', label: 'الأشجار الضعيفة / تحتاج تقليم' }); }}><span>ضعيفة / تحتاج متابعة</span><strong>{recordText(selectedWeak.length)}</strong></button>
            <button onClick={() => { setStatusFilter('all'); setSearch(''); onHighlight({ kind: 'diseased', value: 'diseased', label: 'الأشجار المسجل عليها مرض' }); }}><span>توجد عليها حالة مرض/آفة مسجلة</span><strong>{recordText(selectedDiseased.length)}</strong></button>
            <button onClick={() => { setStatusFilter('all'); setSearch(''); }}><span>نقص بيانات الحالة</span><strong>{recordText(selectedPopulatedRows.filter((r) => !r.data.status).length)}</strong></button>
            <button onClick={() => { setStatusFilter('all'); setSearch(''); }}><span>الصنف غير محدد أو مفقود</span><strong>{recordText(selectedPopulatedRows.filter((r) => !r.data.variety || r.data.variety === UNSPECIFIED_VARIETY).length)}</strong></button>
          </div>
          <div className="farm-analytics-footnote">لا يُستنتج مرض أو علاج أو عملية تقليم من التجمعات البصرية؛ تعرض اللوحة ما هو محفوظ فقط.</div>
        </article>

        <article className="farm-analytics-card">
          <div className="farm-analytics-card-head"><div><h3>البنية التحتية</h3><p>ملخص من أنواع الخلايا والممرات المحفوظة</p></div></div>
          <div className="farm-analytics-infra-grid">
            <div><span className="infra-swatch infra-swatch--road" /><span>طرق</span><strong>{recordText(derived.infra.road || 0)}</strong></div>
            <div><span className="infra-swatch infra-swatch--water" /><span>مروى</span><strong>{recordText(derived.infra.water_canal || 0)}</strong></div>
            <div><span className="infra-swatch infra-swatch--drain" /><span>مصارف</span><strong>{recordText(derived.infra.drainage || 0)}</strong></div>
            <div><span>🛢️</span><span>أحواض رش</span><strong>{recordText(derived.infra.spray_tank || 0)}</strong></div>
          </div>
          <div className="farm-analytics-footnote">عدد الخلايا/المواقع المصنفة بنية تحتية: {recordText(derived.infrastructureCells)}. لا توجد في المخطط الحالي سجلات فحص أعطال أو استهلاك مياه.</div>
        </article>

        <article className="farm-analytics-card">
          <div className="farm-analytics-card-head"><div><h3>متابعة الصحة حسب الصف</h3><p>عدد الأشجار المسجل عليها ضعف أو مرض</p></div></div>
          {filteredHealthByRow.length ? <div className="farm-analytics-row-health">{filteredHealthByRow.map((row) => (
            <button key={row.rowIndex} className="farm-analytics-row-health-item" onClick={() => { setRowFilter(String(row.rowIndex)); setStatusFilter('all'); setSearch(''); }}>
              <span>الصف {row.label}</span><span className="farm-analytics-row-health-track"><i style={{ width: `${(row.weak / Math.max(1, row.total)) * 100}%` }} /><b style={{ width: `${(row.diseased / Math.max(1, row.total)) * 100}%` }} /></span><strong>{row.weak} ضعيفة · {row.diseased} مرض</strong>
            </button>
          ))}</div> : <div className="farm-analytics-empty">لا توجد سجلات محفوظة تكفي للمقارنة بين الصفوف.</div>}
          <div className="farm-analytics-footnote">اضغط على صف لعرض مواقعه في الجدول. قد تتداخل الفئتان عندما تُسجل الحالتان على الشجرة نفسها.</div>
        </article>
      </div>

      <article className="farm-analytics-card farm-analytics-alerts-card">
        <div className="farm-analytics-card-head"><div><h3>مركز التنبيهات والمتابعة</h3><p>العناصر التالية مبنية على حقول مسجلة؛ لا تُنشأ مهام أو مواعيد غير موجودة</p></div><span className="farm-analytics-alert-count">{recordText(visibleAlerts.length)}</span></div>
        {visibleAlerts.length ? <div className="farm-analytics-alert-list">{visibleAlerts.slice(0, 40).map((row) => (
          <button key={row.cellId} className="farm-analytics-alert-row" onClick={() => onSelectTree(row.cellId)}>
            <span className={`farm-analytics-alert-mark ${row.priority === 0 ? 'is-priority' : ''}`}><AlertTriangle size={14} /></span>
            <span className="farm-analytics-alert-main"><strong>{row.coordinate}</strong><small>{row.reasons.join(' · ')}</small></span>
            <span className="farm-analytics-alert-action">فتح السجل</span>
          </button>
        ))}</div> : <div className="farm-analytics-empty">لا توجد تنبيهات مستندة إلى البيانات المسجلة حالياً.</div>}
        {visibleAlerts.length > 40 && <p className="farm-analytics-footnote">يتم عرض أول 40 تنبيهاً هنا؛ يمكن العثور على بقية السجلات من الجدول والمرشحات أدناه.</p>}
      </article>

      <div className="farm-analytics-data-row">
        <div><span>اكتمال المعلومات</span><strong>{recordText(selectedPopulatedRows.length ? selectedPopulatedRows.length - selectedMissingRequired : 0)} / {recordText(selectedPopulatedRows.length)}</strong><small>السجلات المطابقة التي تحتوي الحالة والصنف وتاريخ الحفظ</small></div>
        <div><span>آخر تحديث مسجل</span><strong>{selectedLatestTimestamp ? selectedLatestTimestamp.replace('T', ' ').slice(0, 19) : 'غير متاح'}</strong><small>من حقول تحديث الأشجار؛ ليس بالضرورة وقت مزامنة السحابة</small></div>
        <div><span>حالة التزامن</span><strong>{syncCopy}</strong><small>{syncStatus === 'offline' ? 'قد تكون النتائج مبنية على بيانات مخزنة مؤقتاً.' : 'يعرض شريط التطبيق حالة الاتصال والمزامنة.'}</small></div>
      </div>

      <article className="farm-analytics-card farm-analytics-table-card">
        <div className="farm-analytics-card-head farm-analytics-table-head">
          <div><h3>سجل الأشجار والمواقع</h3><p>{recordText(filteredRows.length)} نتيجة من {recordText(derived.rows.length)} موقع زراعة</p></div>
          <button className="farm-analytics-export" onClick={() => downloadCsv(filteredRows)}><Download size={15} /> تصدير CSV</button>
        </div>
        <div className="farm-analytics-filters">
          <label><Search size={15} /><input aria-label="بحث في الأشجار" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالإحداثي أو الحالة أو الصنف" /></label>
          <select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">كل الحالات</option><option value="فارغة">مواقع خالية</option>{derived.statusCounts.map(([s]) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
          <select aria-label="تصفية حسب الصنف" value={varietyFilter} onChange={(e) => setVarietyFilter(e.target.value)}><option value="all">كل الأصناف</option>{derived.varietyCounts.map(([v]) => <option key={v} value={v}>{v}</option>)}</select>
          <select aria-label="تصفية حسب الصف" value={rowFilter} onChange={(e) => setRowFilter(e.target.value)}><option value="all">كل الصفوف</option>{rowLabels.map((label, i) => <option key={`${label}-${i}`} value={String(i)}>الصف {label}</option>)}</select>
          <button className="farm-analytics-reset" onClick={() => { setSearch(''); setStatusFilter('all'); setVarietyFilter('all'); setRowFilter('all'); setSortBy('coordinate'); setSortDirection('asc'); }}><RefreshCw size={14} /> إعادة ضبط</button>
        </div>
        <div className="farm-analytics-table-scroll">
          <table className="farm-analytics-table"><thead><tr>
            <th><button className="farm-analytics-sort" aria-sort={sortBy === 'coordinate' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => { setSortBy('coordinate'); setSortDirection((d) => sortBy === 'coordinate' && d === 'asc' ? 'desc' : 'asc'); }}>الإحداثي ↕</button></th>
            <th><button className="farm-analytics-sort" aria-sort={sortBy === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => { setSortBy('status'); setSortDirection((d) => sortBy === 'status' && d === 'asc' ? 'desc' : 'asc'); }}>الحالة المعروضة ↕</button></th>
            <th><button className="farm-analytics-sort" aria-sort={sortBy === 'variety' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => { setSortBy('variety'); setSortDirection((d) => sortBy === 'variety' && d === 'asc' ? 'desc' : 'asc'); }}>الصنف ↕</button></th>
            <th>المرض المسجل</th>
            <th><button className="farm-analytics-sort" aria-sort={sortBy === 'lastUpdated' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => { setSortBy('lastUpdated'); setSortDirection((d) => sortBy === 'lastUpdated' && d === 'asc' ? 'desc' : 'asc'); }}>آخر تحديث ↕</button></th>
            <th>الإجراء</th></tr></thead><tbody>
            {filteredRows.slice(0, 500).map((row) => <tr key={row.cellId}>
              <td className="farm-analytics-coordinate">{row.coordinate}</td><td>{row.populated ? statusLabel(row.data.status || 'حالة غير مسجلة') : <span className="farm-analytics-empty-pill">فارغة</span>}</td><td>{row.populated ? row.data.variety || UNSPECIFIED_VARIETY : '—'}</td><td>{row.data.disease && row.data.disease !== NO_DISEASE ? row.data.disease : '—'}</td><td>{row.data.lastUpdated ? row.data.lastUpdated.replace('T', ' ').slice(0, 16) : '—'}</td><td><button className="farm-analytics-row-action" onClick={() => onSelectTree(row.cellId)}>{row.populated ? 'عرض الشجرة' : 'فتح الموقع'}</button></td>
            </tr>)}
            {!filteredRows.length && <tr><td colSpan={6} className="farm-analytics-no-results">لا توجد نتائج مطابقة للمرشحات الحالية.</td></tr>}
          </tbody></table>
        </div>
        {filteredRows.length > 500 && <p className="farm-analytics-footnote">يتم عرض أول 500 صف لتحسين الاستجابة. تصدير CSV يتضمن كل النتائج المطابقة.</p>}
      </article>

      <div className="farm-analytics-unavailable-grid">
        <article><h3>الإنتاج والحصاد</h3><p>لا يحتوي نموذج البيانات الحالي على أوزان حصاد أو مواسم إنتاج. لذلك لا تُعرض قيم إنتاج أو توقعات غير مسجلة.</p><small>البيانات المطلوبة: كمية الحصاد، الوحدة، تاريخ/موسم الحصاد، وربط اختياري بالشجرة أو الصف.</small></article>
        <article><h3>العمليات والمهام الزراعية</h3><p>لا توجد سجلات عمليات أو جداول استحقاق مستقلة في المخطط الحالي؛ حالة «ضعيفة» لا تعني أن التقليم قد نُفذ أو لم يُنفذ.</p><small>البيانات المطلوبة: نوع العملية، التاريخ، النطاق، حالة الإنجاز، وتاريخ الاستحقاق الاختياري.</small></article>
        <article><h3>المصروفات والإيرادات</h3><p>لا توجد سجلات مالية في المخطط الحالي، ولذلك لا يمكن حساب التكلفة أو الإيراد أو صافي الربح.</p><small>البيانات المطلوبة: المبلغ، النوع، التاريخ، البند، والفترة أو الموسم.</small></article>
        <article><h3>التاريخ والمقارنات</h3><p>الحقول الحالية تمثل الحالة الراهنة فقط. لا يمكن حساب تغيرات تاريخية موثوقة ما لم توجد لقطات أو سجلات سابقة فعلية.</p><small>لم يتم إنشاء تاريخ أو قيم سابقة افتراضية.</small></article>
      </div>
      <p className="farm-analytics-bottom-note">تُشتق الأرقام من بيانات المزرعة الحالية للمستخدم المسجل دخوله. عند عدم توفر اتصال، قد تعتمد التحليلات على نسخة Firestore المحلية، ولا تعني المزامنة غير المتحققة أن البيانات هي الأحدث سحابياً.</p>
    </section>
  );
});
