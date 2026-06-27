'use client';

import dynamic from 'next/dynamic';
import { useEngine } from '@/lib/engine';
import LandingPage from '@/components/LandingPage';
import TopBar from '@/components/TopBar';
import Sidebar from '@/components/Sidebar';
import TelemetryPanel from '@/components/TelemetryPanel';

const UniverseCanvas = dynamic(() => import('@/components/UniverseCanvas'), { ssr: false });

export default function Home() {
  const { config } = useEngine();

  if (!config) {
    return <LandingPage />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar />
      <div className="main-layout">
        <Sidebar />
        <div className="canvas-area">
          <UniverseCanvas />
        </div>
        <TelemetryPanel />
      </div>
    </div>
  );
}
