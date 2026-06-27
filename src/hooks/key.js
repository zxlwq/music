import { useEffect } from 'react';

export const useKey = (
  passwordOpen,
  settingsOpen,
  progressOpen,
  setPasswordOpen,
  setSettingsOpen,
  setProgressOpen,
  setPendingDeleteUrl,
  setPendingDeleteName,
) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.contentEditable === 'true'
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.key.startsWith('F') && e.key.length <= 3) {
        return;
      }
      if (e.key === 'F5' || e.code === 'F5') {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (passwordOpen) {
          setPasswordOpen(false);
          setPendingDeleteUrl('');
          setPendingDeleteName('');
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else if (progressOpen) {
          setProgressOpen(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    passwordOpen,
    settingsOpen,
    progressOpen,
    setPasswordOpen,
    setSettingsOpen,
    setProgressOpen,
    setPendingDeleteUrl,
    setPendingDeleteName,
  ]);
};
