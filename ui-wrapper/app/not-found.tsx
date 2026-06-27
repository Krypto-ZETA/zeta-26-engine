'use client';

export default function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#111827', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>404</h1>
        <p style={{ color: '#6b7280' }}>Page not found</p>
      </div>
    </div>
  );
}
