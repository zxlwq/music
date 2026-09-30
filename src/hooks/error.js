import { useErrorHandling } from '../utils/errors';

export const useError = () => {
  const { handleError, handleAsyncError, errorLog, errorStats } = useErrorHandling();

  return {
    handleError,
    handleAsyncError,
    errorLog,
    errorStats,
  };
};
