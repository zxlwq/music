import { useEffect, useRef, useState } from 'react';
import { getAudioAuraSettings } from '../utils/AudioAura';

const GRAPH_KEY = '__musicReactiveGraph';

/**
 * 将 <audio> 接入 Analyser，按帧写入容器 CSS 变量驱动各面板光环。
 * createMediaElementSource 每元素仅能调用一次，图挂在 audio 上复用。
 *
 * 切歌时 isPlaying 可能一直为 true，但 media 会短暂 paused；
 * 必须监听 play/playing，否则 RAF 停掉后不会自动恢复。
 */
export function useAudioReactive(audioRef, panelRef, isPlaying) {
  const rafRef = useRef(0);
  const angleRef = useRef(0);
  const [auraEnabled, setAuraEnabled] = useState(() => getAudioAuraSettings().enabled);

  useEffect(() => {
    const sync = () => setAuraEnabled(getAudioAuraSettings().enabled);
    window.addEventListener('audioAuraSettingsChanged', sync);
    return () => window.removeEventListener('audioAuraSettingsChanged', sync);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const panel = panelRef.current;
    if (!audio || !panel) return undefined;

    const host = panel.closest('.container') || panel;
    let cancelled = false;

    const ensureGraph = () => {
      if (audio[GRAPH_KEY]) return audio[GRAPH_KEY];
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        const ctx = new AC();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        const data = new Uint8Array(analyser.frequencyBinCount);
        audio[GRAPH_KEY] = { ctx, analyser, data };
        return audio[GRAPH_KEY];
      } catch (err) {
        console.warn('音频可视化接入失败:', err);
        return null;
      }
    };

    const clearAura = () => {
      host.style.setProperty('--aura-energy', '0');
      host.style.setProperty('--aura-bass', '0');
      host.style.setProperty('--aura-mid', '0');
      host.style.setProperty('--aura-treble', '0');
      host.classList.remove('audio-aura-active');
    };

    const stopRaf = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const tick = () => {
      if (cancelled) return;
      const graph = audio[GRAPH_KEY];
      if (!graph || !auraEnabled || audio.paused) {
        stopRaf();
        clearAura();
        return;
      }

      const { analyser, data } = graph;
      analyser.getByteFrequencyData(data);
      const n = data.length;
      const third = Math.max(1, Math.floor(n / 3));
      let bassSum = 0;
      let midSum = 0;
      let trebleSum = 0;
      for (let i = 0; i < third; i++) bassSum += data[i];
      for (let i = third; i < third * 2; i++) midSum += data[i];
      for (let i = third * 2; i < n; i++) trebleSum += data[i];

      let bass = Math.min(1, (bassSum / (third * 255)) * 1.65);
      let mid = Math.min(1, (midSum / (third * 255)) * 1.45);
      let treble = Math.min(1, (trebleSum / (Math.max(1, n - third * 2) * 255)) * 1.35);
      let energy = Math.min(1, bass * 0.5 + mid * 0.35 + treble * 0.15);

      // CORS / 空数据时轻微起伏
      if (energy < 0.04) {
        const t = performance.now() / 1000;
        energy = 0.22 + Math.sin(t * 2.6) * 0.1;
        bass = 0.18 + Math.sin(t * 2.1) * 0.08;
        mid = 0.14 + Math.sin(t * 3.1) * 0.06;
        treble = 0.12 + Math.sin(t * 4.2) * 0.05;
      }

      angleRef.current = (angleRef.current + 1.4 + energy * 5.5 + bass * 2.5) % 360;

      host.style.setProperty('--aura-energy', energy.toFixed(3));
      host.style.setProperty('--aura-bass', bass.toFixed(3));
      host.style.setProperty('--aura-mid', mid.toFixed(3));
      host.style.setProperty('--aura-treble', treble.toFixed(3));
      host.style.setProperty('--aura-angle', angleRef.current.toFixed(1));
      host.classList.add('audio-aura-active');

      rafRef.current = requestAnimationFrame(tick);
    };

    const start = async () => {
      if (cancelled || !auraEnabled || audio.paused) {
        stopRaf();
        clearAura();
        return;
      }
      const graph = ensureGraph();
      if (!graph) return;
      try {
        if (graph.ctx.state === 'suspended') await graph.ctx.resume();
      } catch {
        /* ignore */
      }
      if (cancelled || audio.paused) return;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      void start();
    };
    const onPause = () => {
      stopRaf();
      clearAura();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);

    if (auraEnabled && isPlaying && !audio.paused) {
      void start();
    } else if (!auraEnabled || audio.paused) {
      stopRaf();
      clearAura();
    }

    return () => {
      cancelled = true;
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      stopRaf();
      clearAura();
    };
  }, [audioRef, panelRef, isPlaying, auraEnabled]);
}
