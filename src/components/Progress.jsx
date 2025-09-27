import React from 'react'

export default function Progress({ open, title, message, progress, onCancel }) {
  if (!open) return null
  const pct = Math.max(0, Math.min(100, Number(progress) || 0))
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title" style={{ textAlign: 'center' }}>{title || '处理中'}</h3>
        <div className="modal-body">
          <p style={{ marginTop: 4, marginBottom: 12 }}>{message || ''}</p>
          <div style={{ background: 'rgba(255,255,255,.12)', height: 10, borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,.18)' }} aria-label="进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} role="progressbar">
            <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, #ffb3d1, #ff8fb3)' }} />
          </div>
          <div style={{ textAlign: 'right', color: '#a0a0a7', marginTop: 6, fontSize: 12 }}>{pct}%</div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>关闭</button>
        </div>
      </div>
    </div>
  )
}
