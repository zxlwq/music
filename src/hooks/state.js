import { useState } from 'react';

export const useAppState = () => {
  const [tracks, setTracks] = useState([]);
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forcePlayKey, setForcePlayKey] = useState(0);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState('');
  const [pendingDeleteName, setPendingDeleteName] = useState('');
  const [passwordErrorCount, setPasswordErrorCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressTitle, setProgressTitle] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [progressValue, setProgressValue] = useState(0);

  return {
    tracks,
    setTracks,
    query,
    setQuery,
    currentIndex,
    setCurrentIndex,
    loading,
    setLoading,
    error,
    setError,
    forcePlayKey,
    setForcePlayKey,

    passwordOpen,
    setPasswordOpen,
    settingsOpen,
    setSettingsOpen,
    progressOpen,
    setProgressOpen,

    pendingDeleteUrl,
    setPendingDeleteUrl,
    pendingDeleteName,
    setPendingDeleteName,
    passwordErrorCount,
    setPasswordErrorCount,

    progressTitle,
    setProgressTitle,
    progressMessage,
    setProgressMessage,
    progressValue,
    setProgressValue,
  };
};
