import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || 'Global'}] Uncaught error:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary-container" style={{
          padding: '2rem',
          margin: '1rem',
          background: 'rgba(255, 77, 77, 0.1)',
          border: '1px solid #ff4d4d',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#ececf1'
        }}>
          <h2 style={{ color: '#ff4d4d', marginBottom: '1rem' }}>⚠️ Oups, quelque chose a mal tourné</h2>
          <p style={{ opacity: 0.8, marginBottom: '1.5rem' }}>
            Une erreur s'est produite dans le composant <strong>{this.props.name || 'Application'}</strong>.
          </p>
          <div style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            marginBottom: '1.5rem',
            textAlign: 'left',
            overflowX: 'auto'
          }}>
            {this.state.error?.message}
          </div>
          <button 
            onClick={this.handleReset}
            style={{
              background: '#ff4d4d',
              color: 'white',
              border: 'none',
              padding: '0.8rem 1.5rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'transform 0.2s'
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Recharger l'application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
