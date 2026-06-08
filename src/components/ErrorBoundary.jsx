import { Component } from 'react';

/**
 * React Error Boundary — wraps page-level components.
 * Catches render/lifecycle errors and shows a graceful fallback
 * instead of a blank white screen. Resets when the user navigates
 * away (via the `resetKey` prop, which should change on navigation).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack ?? '');
    this.setState({ info });
  }

  // Reset when the parent changes the resetKey (e.g. navigation)
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 48, textAlign: 'center',
          height: '100%', gap: 12,
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
            Something went wrong
          </div>
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420,
            background: 'var(--bg-raised)', border: '1px solid var(--text-muted)',
            borderRadius: 8, padding: '10px 16px',
            fontFamily: 'monospace', textAlign: 'left', wordBreak: 'break-word',
          }}>
            {this.state.error.message}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => this.setState({ error: null, info: null })}
            >
              Try again
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Your data is safe. Navigate to another page or reload to continue.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
