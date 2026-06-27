'use client';

import { useState } from 'react';
import { useEngine } from '@/lib/engine';

export default function TelemetryPanel() {
  const { routeResult, routeStatus } = useEngine();
  const [expandedHop, setExpandedHop] = useState<number | null>(null);

  if (routeStatus === 'undeliverable') {
    return (
      <div className="telemetry">
        <div className="telemetry-content">
          <div className="t-hdr">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Telemetry
          </div>
          <div className="t-undeliverable">
            <div className="t-undeliverable-icon">⚠</div>
            <div className="t-undeliverable-title">UNDELIVERABLE</div>
            <div className="t-undeliverable-desc">
              No viable route exists between these planets. All intermediate bridges may be destroyed.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!routeResult) {
    return (
      <div className="telemetry">
        <div className="telemetry-content">
          <div className="t-hdr">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Telemetry
          </div>
          <div className="t-empty">
            No route data yet. Select a source and destination, then send a packet.
          </div>
        </div>
      </div>
    );
  }

  const { origin_id, destination_id, payload, total_latency_ms, hop_log } = routeResult;
  const pad = (n: number | null | undefined) => (n == null ? '—' : String(n));

  const sumFiber = hop_log.reduce((s, h) => s + (h.fiber_transit_ms ?? 0), 0);
  const sumTower = hop_log.reduce((s, h) => s + (h.tower_delay_ms ?? 0), 0);
  const sumAtmo = hop_log.reduce((s, h) => s + (h.atmospheric_refraction_ms ?? 0), 0);
  const sumVoid = hop_log.reduce((s, h) => s + (h.void_transmission_ms ?? 0), 0);
  const sumTp = sumFiber + sumTower;
  const sumTv = sumAtmo + sumVoid;

  const components = [
    { label: 'Fiber Propagation', ms: sumFiber, color: '#3b82f6', group: 'tp' as const },
    { label: 'Node Hardware Delay', ms: sumTower, color: '#f59e0b', group: 'tp' as const },
    { label: 'Atmospheric Media Delay', ms: sumAtmo, color: '#a78bfa', group: 'tv' as const },
    { label: 'Pure Space Travel', ms: sumVoid, color: '#22d3ee', group: 'tv' as const },
  ];

  const totalPct = components.reduce((s, c) => s + (isFinite(c.ms) ? c.ms : 0), 0);
  const MIN_SEG_PCT = 3;

  return (
    <div className="telemetry">
      <div className="telemetry-content">
        <div className="t-hdr">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Telemetry
        </div>
        <div className="t-meta">
          <div className="t-mr"><span className="t-lbl">Origin</span><span className="t-val">{origin_id}</span></div>
          <div className="t-mr"><span className="t-lbl">Destination</span><span className="t-val">{destination_id}</span></div>
          <div className="t-mr"><span className="t-lbl">Payload</span><span className="t-val">{payload}</span></div>
          <div className="t-mr"><span className="t-lbl">Latency</span><span className="t-val">{total_latency_ms.toFixed(2)} ms</span></div>
          <div className="t-mr"><span className="t-lbl">Hops</span><span className="t-val">{hop_log.length}</span></div>
        </div>

        <div className="t-breakdown">
          <div className="t-breakdown-title">Latency Breakdown</div>
          <div className="t-breakdown-bar">
            {total_latency_ms > 0 && components.map((c, i) => {
              const rawPct = isFinite(c.ms) ? (c.ms / totalPct) * 100 : 0;
              const visPct = Math.max(rawPct, totalPct > 0 && c.ms > 0 ? MIN_SEG_PCT : 0);
              return (
                <div
                  key={i}
                  className="t-breakdown-seg"
                  style={{
                    width: `${visPct}%`,
                    background: c.color,
                  }}
                  title={`${c.label}: ${isFinite(c.ms) ? c.ms.toFixed(1) : '0'} ms (${rawPct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="t-breakdown-rows">
            {components.map((c, i) => (
              <div key={i} className="t-breakdown-row">
                <span className="t-bd-dot" style={{ background: c.color }} />
                <span className="t-bd-label">{c.label}</span>
                <span className="t-bd-val">{isFinite(c.ms) ? c.ms.toFixed(1) : '0'} ms</span>
                <span className="t-bd-pct">{totalPct > 0 && isFinite(c.ms) ? ((c.ms / totalPct) * 100).toFixed(1) : 0}%</span>
              </div>
            ))}
            <div className="t-breakdown-subtotal">
              <span>ΣT<sub>p</sub> = {isFinite(sumTp) ? sumTp.toFixed(1) : '0'} ms &nbsp;&nbsp;|&nbsp;&nbsp; ΣT<sub>v</sub> = {isFinite(sumTv) ? sumTv.toFixed(1) : '0'} ms</span>
            </div>
          </div>
        </div>

        <div className="t-hops">
          <div className="t-hh">
            <span>Planet</span>
            <span>In</span>
            <span>Out</span>
            <span>Payload</span>
            <span>Tp</span>
            <span>Tv</span>
          </div>
          {hop_log.map((hop, i) => {
            const isExpanded = expandedHop === i;
            return (
              <div key={i}>
                <div
                  className={`t-hr${isExpanded ? ' t-hr-expanded' : ''}`}
                  onClick={() => setExpandedHop(isExpanded ? null : i)}
                >
                  <span className="th-p">{hop.planet}</span>
                  <span className="th-t">{pad(hop.tower_entry)}</span>
                  <span className="th-t">{pad(hop.tower_exit)}</span>
                  <span className="th-s" title={hop.payload_state}>{hop.payload_state}</span>
                  <span className="th-t">{hop.tp_ms.toFixed(1)}</span>
                  <span className="th-t">{hop.tv_from_prev_ms != null ? hop.tv_from_prev_ms.toFixed(1) : '—'}</span>
                </div>
                {isExpanded && (
                  <div className="t-hr-detail">
                    <div className="t-detail-row">
                      <span className="t-detail-dot" style={{ background: '#3b82f6' }} />
                      <span className="t-detail-lbl">Fiber Transit</span>
                      <span className="t-detail-val">{hop.fiber_transit_ms != null ? hop.fiber_transit_ms.toFixed(1) : '—'} ms</span>
                    </div>
                    <div className="t-detail-row">
                      <span className="t-detail-dot" style={{ background: '#f59e0b' }} />
                      <span className="t-detail-lbl">Tower Delay</span>
                      <span className="t-detail-val">{hop.tower_delay_ms != null ? hop.tower_delay_ms.toFixed(1) : '—'} ms</span>
                    </div>
                    <div className="t-detail-row">
                      <span className="t-detail-dot" style={{ background: '#a78bfa' }} />
                      <span className="t-detail-lbl">Atmospheric Refraction</span>
                      <span className="t-detail-val">{hop.atmospheric_refraction_ms != null ? hop.atmospheric_refraction_ms.toFixed(1) : '—'} ms</span>
                    </div>
                    <div className="t-detail-row">
                      <span className="t-detail-dot" style={{ background: '#22d3ee' }} />
                      <span className="t-detail-lbl">Void Transmission</span>
                      <span className="t-detail-val">{hop.void_transmission_ms != null ? hop.void_transmission_ms.toFixed(1) : '—'} ms</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
