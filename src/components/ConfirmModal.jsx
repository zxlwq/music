import React from 'react'

export default function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title ? <h3 className="modal-title">{title}</h3> : null}
        <div className="modal-body">{message}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button type="button" className="btn-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  )
}


