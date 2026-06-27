'use client';

import { useRef, useCallback } from 'react';
import { useEngine } from '@/lib/engine';
import { validateFile, validateConfig } from '@/lib/validation';

export default function TopBar() {
  const { loadConfig } = useEngine();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const fileResult = validateFile(file);
    if (!fileResult.valid) {
      alert(fileResult.error);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        const configResult = validateConfig(data);
        if (!configResult.valid) {
          alert(configResult.error);
          return;
        }
        loadConfig(data);
      } catch (err) {
        alert('Invalid JSON: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  }, [loadConfig]);

  return (
    <div className="topbar">
      <span className="t-zeta">ZETA-26</span>
      <span className="t-gap" />
      <span className="t-proto">Network Platform</span>
      <span className="t-launch">v1.0</span>
      <div className="t-right">
        <span className="t-dot" />
        <span className="t-online">Online</span>
        <button className="t-upload-btn" onClick={() => fileRef.current?.click()} title="Load new config">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <input
          type="file"
          ref={fileRef}
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
