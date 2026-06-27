import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export function useVScroll({
  items = [],
  itemHeight = 60,
  containerHeight = 400,
  overscan = 5,
  enableSmoothScrolling = true,
  scrollBehavior = 'smooth',
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeightState, setContainerHeightState] = useState(containerHeight);
  const scrollTimeoutRef = useRef(null);
  const isScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const visibleRange = useMemo(() => {
    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeightState / itemHeight) + overscan,
      items.length - 1,
    );

    return {
      start: Math.max(0, startIndex - overscan),
      end: endIndex,
    };
  }, [scrollTop, itemHeight, containerHeightState, overscan, items.length]);

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1).map((item, index) => ({
      ...item,
      index: visibleRange.start + index,
      originalIndex: visibleRange.start + index,
    }));
  }, [items, visibleRange]);

  const totalHeight = items.length * itemHeight;

  const offsetY = visibleRange.start * itemHeight;

  const handleScroll = useCallback((e) => {
    const newScrollTop = e.target.scrollTop;
    const delta = Math.abs(newScrollTop - lastScrollTopRef.current);

    if (delta < 1) return;

    setScrollTop(newScrollTop);
    lastScrollTopRef.current = newScrollTop;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 16);

    isScrollingRef.current = true;
  }, []);

  const scrollToIndex = useCallback(
    (index) => {
      const container = containerRef.current;
      if (!container) return;

      const targetScrollTop = index * itemHeight;

      if (enableSmoothScrolling) {
        container.scrollTo({
          top: targetScrollTop,
          behavior: scrollBehavior,
        });
      } else {
        container.scrollTop = targetScrollTop;
      }
    },
    [itemHeight, enableSmoothScrolling, scrollBehavior],
  );

  const scrollToItem = useCallback(
    (item) => {
      const index = items.findIndex((i) => i === item);
      if (index !== -1) {
        scrollToIndex(index);
      }
    },
    [items, scrollToIndex],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeightState(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    scrollTop,
    containerHeightState,
    visibleRange,
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    scrollToIndex,
    scrollToItem,
    get isScrolling() {
      return isScrollingRef.current;
    },
  };
}

export function useVScrollMetrics() {
  const metricsRef = useRef({
    renderCount: 0,
    scrollEvents: 0,
    lastRenderTime: 0,
    averageRenderTime: 0,
  });

  const updateMetrics = useCallback((type) => {
    const now = performance.now();
    const metrics = metricsRef.current;

    if (type === 'render') {
      metrics.renderCount++;
      if (metrics.lastRenderTime > 0) {
        const renderTime = now - metrics.lastRenderTime;
        metrics.averageRenderTime = (metrics.averageRenderTime + renderTime) / 2;
      }
      metrics.lastRenderTime = now;
    } else if (type === 'scroll') {
      metrics.scrollEvents++;
    }
  }, []);

  const getMetrics = useCallback(
    () => ({
      ...metricsRef.current,
      performance: {
        averageRenderTime: metricsRef.current.averageRenderTime,
        renderCount: metricsRef.current.renderCount,
        scrollEvents: metricsRef.current.scrollEvents,
      },
    }),
    [],
  );

  return {
    updateMetrics,
    getMetrics,
  };
}
