'use client';

import { useRef, useCallback, useState } from 'react';
import { useEngine } from '@/lib/engine';
import { validateFile, validateConfig } from '@/lib/validation';

export default function LandingPage() {
  const { loadConfig } = useEngine();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    setError('');
    const fileResult = validateFile(file);
    if (!fileResult.valid) {
      setError(fileResult.error!);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        const configResult = validateConfig(data);
        if (!configResult.valid) {
          setError(configResult.error!);
          return;
        }
        loadConfig(data);
      } catch (err) {
        setError('Invalid JSON file. Please check the format.');
      }
    };
    reader.readAsText(file);
  }, [loadConfig]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div className="landing">
      <div className="landing-bg">
        {Array.from({ length: 50 }, (_, i) => (
          <div
            key={i}
            className={`landing-star${i % 9 === 0 ? ' landing-star-bright' : ''}`}
            style={{
              left: `${(i * 137.508 + 42) % 100}%`,
              top: `${(i * 97.3 + 17) % 100}%`,
              width: `${0.8 + (i % 5) * 0.4}px`,
              height: `${0.8 + (i % 5) * 0.4}px`,
              opacity: 0.15 + (i % 8) * 0.06,
              animationDelay: `${(i * 0.23) % 6}s`,
              animationDuration: `${3 + (i % 4)}s`,
            }}
          />
        ))}
      </div>

      <div className="landing-content">
        <div className="landing-badge">ZETA-26</div>
        <h1 className="landing-title">Interplanetary Network Router</h1>
        <p className="landing-subtitle">
          Load a universe configuration to visualize nodes, routes, and packet telemetry across planetary networks.
        </p>

        <div
          className={`landing-upload ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <div className="landing-upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="landing-upload-text">
            {dragOver ? 'Drop your file here' : 'Drop your JSON config here'}
          </div>
          <div className="landing-upload-hint">
            or click to browse
          </div>
        </div>

        {error && <div className="landing-error">{error}</div>}

        <input
          type="file"
          ref={fileRef}
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <div className="landing-footer">
          <span>Rust WASM Engine</span>
          <span className="landing-dot">·</span>
          <span>TypeScript Integration</span>
          <span className="landing-dot">·</span>
          <span>Real-time Telemetry</span>
        </div>
      </div>
    </div>
  );
}
