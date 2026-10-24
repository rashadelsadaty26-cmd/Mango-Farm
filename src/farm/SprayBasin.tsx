import React from 'react';

// ============================================================================
// Spray basin artwork. Pure presentation: it never reads or changes the stored
// cell record (type 'spray_tank'); it only replaces how that cell is drawn.
//
// The drawing is a self-contained 100x100 SVG that is centred and fitted
// ("meet") inside its cell, so it can never be clipped or distorted whatever the
// cell metrics are, and it scales cleanly with the map zoom. Flat fills only
// (no gradients / ids), so many basins on one map cannot clash.
// ============================================================================

export const SprayBasin = React.memo(function SprayBasin() {
  return (
    <div className="farm-spray-tank" aria-label="حوض رش" title="حوض رش" role="img">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        {/* ground shadow */}
        <ellipse cx="50" cy="90" rx="39" ry="5.5" fill="#000" opacity="0.13" />

        {/* concrete rim, lip and inner wall */}
        <rect x="6" y="22" width="88" height="64" rx="16" fill="#aab6b1" />
        <rect x="6" y="22" width="88" height="60" rx="16" fill="#d5dcd8" stroke="#7d8b86" strokeWidth="2" />
        <rect x="12" y="28" width="76" height="48" rx="11" fill="#eef2f0" stroke="#aebab5" strokeWidth="1.2" />

        {/* water */}
        <rect x="16" y="32" width="68" height="40" rx="8" fill="#0ea5e9" />
        <rect x="16" y="32" width="68" height="17" rx="8" fill="#38bdf8" />
        <path
          className="farm-spray-wave"
          d="M24 41q6-3 12 0t12 0 12 0 12 0"
          fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round"
        />

        {/* supply pipe + nozzle with spray (top-right) */}
        <rect x="71" y="7" width="8" height="20" rx="2.5" fill="#64748b" stroke="#475569" strokeWidth="1" />
        <rect x="66" y="5" width="18" height="7" rx="3" fill="#475569" />
        <path className="farm-spray-drops" d="M75 18v6M69 17l-3 5M81 17l3 5" stroke="#bae6fd" strokeWidth="2.2" strokeLinecap="round" fill="none" />

        {/* name, inside the water so it travels with the artwork */}
        <text
          className="farm-spray-label"
          x="50" y="62" textAnchor="middle"
          fontSize="12" fontWeight="800" fill="#0c4a6e"
          style={{ fontFamily: "'Cairo', ui-sans-serif, system-ui, sans-serif" }}
        >
          حوض رش
        </text>
      </svg>
    </div>
  );
});
