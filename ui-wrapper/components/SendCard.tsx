'use client';

import { useState } from 'react';
import { useEngine } from '@/lib/engine';

export default function SendCard() {
  const { nodeIds, alive, calculateRoute, routeStatus, loading } = useEngine();
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState('');

  const handleSend = () => {
    setError('');
    if (!origin || !dest) {
      setError('Select origin and destination');
      return;
    }
    if (!alive[origin]) {
      setError('Origin planet is dead — resurrect it first');
      return;
    }
    if (!alive[dest]) {
      setError('Destination planet is dead — resurrect it first');
      return;
    }
    calculateRoute(origin, dest, payload || 'Hello');
  };

  return (
    <div className="card">
      <div className="card-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
          <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
          <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
          <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
          <circle cx="12" cy="12" r="1" />
          <line x1="12" y1="1" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
        Transmit
      </div>

      <div className="form-group">
        <label className="form-label">Origin</label>
        <select
          className="form-select"
          value={origin}
          onChange={(e) => { setOrigin(e.target.value); setError(''); }}
        >
          <option value="">Select origin planet...</option>
          {nodeIds.filter(id => alive[id]).map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Destination</label>
        <select
          className="form-select"
          value={dest}
          onChange={(e) => { setDest(e.target.value); setError(''); }}
        >
          <option value="">Select destination planet...</option>
          {nodeIds.filter(id => alive[id]).map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Message</label>
        <input
          className="form-input"
          placeholder="Enter message (default: Hello)"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
      </div>

      {error && <div className="form-error">{error}</div>}

      <button className="send-btn" onClick={handleSend} disabled={loading || !origin || !dest || !alive[origin] || !alive[dest]}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {loading ? 'Routing...' : 'Send'}
      </button>

      {routeStatus === 'undeliverable' && (
        <div className="result-box result-undeliverable">
          <div className="result-line" style={{ color: '#ef4444', fontWeight: 700 }}>⚠ UNDELIVERABLE</div>
          <div className="result-line" style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>
            No viable route exists. All intermediate bridges may be destroyed.
          </div>
        </div>
      )}
    </div>
  );
}
