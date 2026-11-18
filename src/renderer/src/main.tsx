import React from 'react';
import { createRoot } from 'react-dom/client';
import { STUDIO_VERSION } from '@shared/studio-version';
import './styles/studio.css';
import { App } from './App';

class StudioErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f87171', background: '#090d16', height: '100vh' }}>
          <h2>Errore Renderer Studio</h2>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
document.title = `Visual UI Studio ${STUDIO_VERSION}`;
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <StudioErrorBoundary>
        <App />
      </StudioErrorBoundary>
    </React.StrictMode>,
  );
}
