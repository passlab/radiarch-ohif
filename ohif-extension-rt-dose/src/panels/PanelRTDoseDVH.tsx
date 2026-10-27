// The DVHs the RT Dose in the active viewport carries (for a radiarch export: radiarch's own, on its grid), with each
// structure's minimum, mean and maximum dose and the isodose legend.

import React, { useEffect, useState } from 'react';
import { useViewportGrid } from '@ohif/ui-next';

import { isodoseLevels } from '@radiarch/rt-dose-core';
import { onDoseLoaded } from '../events';
import { ISODOSE_PERCENTS } from '../viewports/OHIFCornerstoneRTDoseViewport';

const W = 300;
const H = 200;
const PAD = { left: 36, right: 8, top: 8, bottom: 28 };

function rgb(color, fallback = '#ccc') {
  return color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : fallback;
}

export function DVHChart({ curves }) {
  const maxDose = Math.max(1e-6, ...curves.map(c => c.maxDoseBinEdgeGy));
  const x = d => PAD.left + (d / maxDose) * (W - PAD.left - PAD.right);
  const y = p => PAD.top + (1 - p / 100) * (H - PAD.top - PAD.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxDose);
  const digits = maxDose < 5 ? 2 : maxDose < 20 ? 1 : 0;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dose-volume histograms" className="bg-black">
      {[0, 25, 50, 75, 100].map(p => (
        <g key={`y${p}`}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="#333" />
          <text x={PAD.left - 4} y={y(p) + 3} fontSize="9" fill="#aaa" textAnchor="end">{p}</text>
        </g>
      ))}
      {ticks.map(d => (
        <text key={`x${d}`} x={x(d)} y={H - PAD.bottom + 12} fontSize="9" fill="#aaa" textAnchor="middle">{d.toFixed(digits)}</text>
      ))}
      <text x={(W + PAD.left) / 2} y={H - 4} fontSize="9" fill="#aaa" textAnchor="middle">Dose (Gy)</text>
      <text x={10} y={H / 2} fontSize="9" fill="#aaa" textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`}>Volume (%)</text>
      {curves.map(c => (
        <polyline
          key={c.roiNumber}
          fill="none"
          stroke={rgb(c.color)}
          strokeWidth="1.5"
          points={Array.from(c.doseGy, (d, i) => `${x(d).toFixed(1)},${y(c.percent[i]).toFixed(1)}`).join(' ')}
        />
      ))}
    </svg>
  );
}

function PanelRTDoseDVH({ servicesManager }: withAppTypes) {
  const { displaySetService } = servicesManager.services;
  const [{ activeViewportId, viewports }] = useViewportGrid();
  const [, setLoadedCount] = useState(0);

  useEffect(() => onDoseLoaded(() => setLoadedCount(n => n + 1)), []);

  const uids = viewports.get(activeViewportId)?.displaySetInstanceUIDs ?? [];
  const dose = uids.map(uid => displaySetService.getDisplaySetByUID(uid)).find(ds => ds?.isRTDose);

  if (!dose) {
    return <div className="p-2 text-sm text-white">Open an RT Dose in the active viewport to see its DVHs.</div>;
  }
  if (!dose.isLoaded) {
    return <div className="p-2 text-sm text-white">Loading the dose…</div>;
  }
  const levels = isodoseLevels(dose.reference.gy, ISODOSE_PERCENTS);
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 overflow-x-hidden break-words p-2 text-white">
      <div className="text-xs text-yellow-300">RESEARCH USE ONLY. Not for clinical use.</div>
      <div className="text-sm">
        {dose.label}: max {dose.dose.max.toFixed(2)} Gy {dose.dose.type === 'EFFECTIVE' ? '(RBE)' : ''}
      </div>
      {dose.dvhs.length ? (
        <>
          <DVHChart curves={dose.dvhs} />
          <div className="text-xs text-gray-300">DVHs from the RT Dose file (computed by the system that wrote it).</div>
          <table className="text-xs">
            <thead>
              <tr><th className="text-left">Structure</th><th>Min</th><th>Mean</th><th>Max (Gy)</th></tr>
            </thead>
            <tbody>
              {dose.dvhs.map(c => (
                <tr key={c.roiNumber}>
                  <td><span style={{ color: rgb(c.color) }}>■</span> {c.name}</td>
                  <td className="text-right">{c.minGy?.toFixed(2) ?? '–'}</td>
                  <td className="text-right">{c.meanGy?.toFixed(2) ?? '–'}</td>
                  <td className="text-right">{c.maxGy?.toFixed(2) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="text-xs text-gray-300">This RT Dose carries no DVHs.</div>
      )}
      <div className="text-xs">
        Isodoses, % of {dose.reference.source === 'prescription' ? 'the prescription' : 'the dose maximum'} ({dose.reference.gy.toFixed(2)} Gy):
        {levels.map(l => (
          <span key={l.percent} className="ml-2" style={{ color: rgb(l.color.map(v => Math.round(v * 255))) }}>
            {l.percent}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default PanelRTDoseDVH;
