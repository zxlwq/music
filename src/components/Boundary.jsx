import React from 'react';
import { AppError, ERROR_TYPES, ERROR_SEVERITY, errorHandler } from '../utils/errors';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(_error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const appError = new AppError(
      error.message || '组件渲染错误',
      ERROR_TYPES.UNKNOWN,
      ERROR_SEVERITY.HIGH,
      'COMPONENT_ERROR',
      {
        componentStack: errorInfo.componentStack,
        errorBoundary: this.props.name || 'ErrorBoundary',
        retryCount: this.state.retryCount,
      },
    );

    errorHandler.handle(appError, 'ErrorBoundary');

    this.setState({
      error: appError,
      errorInfo: errorInfo,
    });

    if (this.props.onError) {
      this.props.onError(appError, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">⚠️</div>
            <h2 className="error-boundary-title">出现错误</h2>
            <p className="error-boundary-message">
              {this.state.error?.message || '应用程序遇到了一个错误'}
            </p>

            {import.meta.env.DEV && (
              <details className="error-boundary-details">
                <summary>错误详情</summary>
                <pre className="error-boundary-stack">{this.state.error?.stack}</pre>
                <pre className="error-boundary-component-stack">
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div className="error-boundary-actions">
              <button
                className="btn btn-primary"
                onClick={this.handleRetry}
                disabled={this.state.retryCount >= 3}
                id="error-retry-btn"
                name="error-retry"
              >
                {this.state.retryCount >= 3 ? '重试次数已达上限' : '重试'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={this.handleReload}
                id="error-reload-btn"
                name="error-reload"
              >
                重新加载页面
              </button>
            </div>

            {this.state.retryCount > 0 && (
              <p className="error-boundary-retry-info">重试次数: {this.state.retryCount}/3</p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function withErrorBoundary(Component, errorBoundaryProps = {}) {
  const WrappedComponent = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useErrorBoundary() {
  const [error, setError] = React.useState(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error) => {
    setError(error);
  }, []);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { captureError, resetError };
}

export default ErrorBoundary;
