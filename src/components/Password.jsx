import React, { useState, useEffect } from 'react'

export default function Password({ open, title, message, onConfirm, onCancel, onPasswordError }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // 重置状态当模态框打开/关闭时
  useEffect(() => {
    if (open) {
      setPassword('')
      setError('')
    }
  }, [open])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('请输入密码')
      return
    }
    
    // 获取环境变量中的密码
    const envPassword = import.meta.env.VITE_PASSWORD
    if (!envPassword) {
      setError('未配置管理员密码，请添加环境变量')
      return
    }
    
    if (password === envPassword) {
      onConfirm()
    } else {
      setError('密码错误')
      onPasswordError && onPasswordError()
    }
  }

  const handleCancel = () => {
    setPassword('')
    setError('')
    onCancel()
  }

  if (!open) return null

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
                  setPassword(e.target.value)
                  setError('')
                }}
                autoFocus
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
          <button type="button" className="btn btn-ghost" onClick={handleCancel}>取消</button>
          <button type="button" className="btn-danger" onClick={handleSubmit}>确认删除</button>
        </div>
      </div>
    </div>
  )
}
