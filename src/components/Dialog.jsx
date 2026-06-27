export default function Dialog({
  open,
  title,
  message,
  value,
  onClose,
  type = 'upload',
  showCancel = true,
  showAnimation = true,
}) {
  if (!open) return null;

  const getTypeIcon = () => {
    switch (type) {
      case 'upload':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7,10 12,15 17,10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        );
      case 'download':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7,14 12,9 17,14"></polyline>
            <line x1="12" y1="9" x2="12" y2="21"></line>
          </svg>
        );
      case 'process':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
          </svg>
        );
      case 'import':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14,2 14,8 20,8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10,9 9,9 8,9"></polyline>
          </svg>
        );
      default:
        return null;
    }
  };

  const getTypeColor = () => {
    switch (type) {
      case 'upload':
        return '#10b981';
      case 'download':
        return '#3b82f6';
      case 'process':
        return '#f59e0b';
      case 'import':
        return '#8b5cf6';
      default:
        return '#10b981';
    }
  };

  const isCompleted = value >= 100;
  const progressColor = getTypeColor();

  return (
    <div className="progress-dialog">
      <div className="progress-dialog-header">
        <h3 className="progress-dialog-title">
          <span className="progress-dialog-icon" style={{ color: progressColor }}>
            {getTypeIcon()}
          </span>
          {title}
        </h3>
      </div>

      <div className="progress-dialog-body">
        <p className="progress-dialog-message">{message}</p>

        <div className="progress-dialog-progress">
          <div className="progress-dialog-progress-track">
            <div
              className="progress-dialog-progress-fill"
              style={{
                width: `${Math.min(100, Math.max(0, value))}%`,
                background: `linear-gradient(90deg, ${progressColor}, ${progressColor}dd)`,
              }}
            ></div>
          </div>
          <div className="progress-dialog-progress-text">
            {isCompleted ? '完成' : `${Math.round(value)}%`}
          </div>
        </div>

        {showAnimation && !isCompleted && (
          <div className="progress-dialog-animation">
            <div className="progress-dots">
              <div className="dot" style={{ background: progressColor }}></div>
              <div className="dot" style={{ background: progressColor }}></div>
              <div className="dot" style={{ background: progressColor }}></div>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="progress-dialog-success">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22,4 12,14.01 9,11.01"></polyline>
            </svg>
            <span>操作完成</span>
          </div>
        )}
      </div>

      {showCancel && (
        <div className="progress-dialog-footer">
          <button
            className="progress-dialog-cancel-btn"
            onClick={onClose}
            id="progress-dialog-cancel-btn"
            name="progress-dialog-cancel"
          >
            {isCompleted ? '关闭' : '取消'}
          </button>
        </div>
      )}
    </div>
  );
}
