import { useState, useEffect } from 'react';
import { ERROR_SEVERITY } from '../utils/errors';

export default function ErrorNotification({ error, onClose, autoClose = true, duration = 5000 }) {
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (autoClose && duration > 0) {
      const interval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev - 100 / (duration / 100);
          if (newProgress <= 0) {
            setVisible(false);
            setTimeout(() => onClose?.(), 300);
            return 0;
          }
          return newProgress;
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [autoClose, duration, onClose]);

  useEffect(() => {
    if (!visible) {
      const timer = setTimeout(() => onClose?.(), 300);
      return () => clearTimeout(timer);
    }
  }, [visible, onClose]);

  if (!error) return null;

  const getSeverityClass = (severity) => {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 'info';
      case ERROR_SEVERITY.MEDIUM:
        return 'warning';
      case ERROR_SEVERITY.HIGH:
        return 'error';
      case ERROR_SEVERITY.CRITICAL:
        return 'critical';
      default:
        return 'error';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 'ℹ️';
      case ERROR_SEVERITY.MEDIUM:
        return '⚠️';
      case ERROR_SEVERITY.HIGH:
        return '❌';
      case ERROR_SEVERITY.CRITICAL:
        return '🚨';
      default:
        return '❌';
    }
  };

  const severityClass = getSeverityClass(error.severity || ERROR_SEVERITY.MEDIUM);
  const severityIcon = getSeverityIcon(error.severity || ERROR_SEVERITY.MEDIUM);

  return (
    <div className={`error-toast ${severityClass} ${visible ? 'visible' : 'hidden'}`}>
      <div className="error-toast-content">
        <div className="error-toast-header">
          <span className="error-toast-icon">{severityIcon}</span>
          <span className="error-toast-title">{error.name || '错误'}</span>
          <button
            className="error-toast-close"
            onClick={() => {
              setVisible(false);
              onClose?.();
            }}
            id="error-toast-close-btn"
            name="error-toast-close"
          >
            ×
          </button>
        </div>
        <div className="error-toast-message">{error.message}</div>
        {error.context && Object.keys(error.context).length > 0 && (
          <details className="error-toast-details">
            <summary>详细信息</summary>
            <pre className="error-toast-context">{JSON.stringify(error.context, null, 2)}</pre>
          </details>
        )}
        {autoClose && duration > 0 && (
          <div className="error-toast-progress">
            <div className="error-toast-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useErrorNotification() {
  const [notifications, setNotifications] = useState([]);

  const addNotification = (error, options = {}) => {
    const id = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const notification = {
      id,
      error,
      ...options,
    };

    setNotifications((prev) => [...prev, notification]);

    return id;
  };

  const removeNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const ErrorNotificationContainer = () => (
    <div className="error-notification-container">
      {notifications.map((notification) => (
        <ErrorNotification
          key={notification.id}
          error={notification.error}
          onClose={() => removeNotification(notification.id)}
          autoClose={notification.autoClose}
          duration={notification.duration}
        />
      ))}
    </div>
  );

  return {
    addNotification,
    removeNotification,
    clearAllNotifications,
    notifications,
    ErrorNotificationContainer,
  };
}
