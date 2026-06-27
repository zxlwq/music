import { createContext, useContext } from 'react';

/** 设置页等子组件可调用的歌单切换动作（由 App 提供，避免挂到 window） */
export const PlaylistActionsContext = createContext(null);

export function usePlaylistActions() {
  const ctx = useContext(PlaylistActionsContext);
  if (ctx == null) {
    throw new Error('usePlaylistActions 须在 App 内 PlaylistActionsContext.Provider 下使用');
  }
  return ctx;
}
