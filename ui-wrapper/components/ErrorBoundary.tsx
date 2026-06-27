'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#fff', color: '#111827',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: 40, textAlign: 'center',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Something went wrong</div>
            <div style={{ fontSize: 12, color: '#6b7280', maxWidth: 400 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                marginTop: 20, padding: '8px 24px', background: '#2563eb',
                color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
