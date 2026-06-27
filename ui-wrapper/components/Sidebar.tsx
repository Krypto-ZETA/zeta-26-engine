'use client';

import { useEngine } from '@/lib/engine';
import PlanetList from './PlanetList';
import SendCard from './SendCard';

export default function Sidebar() {
  const { nodeIds } = useEngine();

  return (
    <div className="sidebar">
      <div className="sidebar-content">
        <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="12" rx="6" ry="6" />
              <ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-20 12 12)" />
            </svg>
            Nodes {nodeIds.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>· {nodeIds.length}</span>}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <PlanetList />
          </div>
        </div>

        <SendCard />
      </div>
    </div>
  );
}
