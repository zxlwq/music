import { useState, useEffect } from 'react';

export default function Password({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  onPasswordError: _onPasswordError,
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 对话框打开时重置状态是合理的
      setPassword('');
      setError('');
    }
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }
    onConfirm && onConfirm(password);
  };

  const handleCancel = () => {
    setPassword('');
    setError('');
    onCancel();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title ? <h3 className="modal-title">{title}</h3> : null}
        <div className="modal-body">
          <p style={{ marginBottom: '16px' }}>{message}</p>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">请输入管理员密码</label>
              <input
                className="form-input"
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                autoFocus
                id="admin-password"
                name="admin-password"
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="text"
              />
              {error && (
                <div className="form-tip" style={{ color: '#f87171', marginTop: '4px' }}>
                  {error}
                </div>
              )}
            </div>
          </form>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            id="cancel-password-btn"
            name="cancel-password"
            onClick={handleCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-danger"
            id="confirm-delete-btn"
            name="confirm-delete"
            onClick={handleSubmit}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
