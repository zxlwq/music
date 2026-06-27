import { forwardRef, useImperativeHandle, useEffect, useRef, useCallback } from 'react';
import { useVScroll, useVScrollMetrics } from '../hooks/VScroll';

const VScroll = forwardRef(
  /**
   * @param {object} root0
   * @param {any[]} [root0.items]
   * @param {number} [root0.itemHeight]
   * @param {number} [root0.containerHeight]
   * @param {number} [root0.overscan]
   * @param {(scrollTop: number) => void} [root0.onScroll]
   * @param {(p: { item: any; index: number; isVisible: boolean }) => import('react').ReactNode} [root0.children]
   * @param {string} [root0.className]
   * @param {import('react').CSSProperties} [root0.style]
   * @param {boolean} [root0.enableSmoothScrolling]
   * @param {string} [root0.scrollBehavior]
   * @param {boolean} [root0.enableMetrics]
   * @param {import('react').ForwardedRef<any>} ref
   */
  function VScroll(
    {
      items = [],
      itemHeight = 60,
      containerHeight = 400,
      overscan = 5,
      onScroll,
      children,
      className = '',
      style = {},
      enableSmoothScrolling = true,
      scrollBehavior = 'smooth',
      enableMetrics = false,
    },
    ref,
  ) {
    const {
      containerRef,
      visibleItems,
      totalHeight,
      offsetY,
      handleScroll,
      scrollToIndex,
      scrollToItem,
    } = useVScroll({
      items,
      itemHeight,
      containerHeight,
      overscan,
      enableSmoothScrolling,
      scrollBehavior,
    });

    const { updateMetrics, getMetrics } = useVScrollMetrics();

    const enhancedHandleScroll = useCallback(
      (e) => {
        handleScroll(e);
        updateMetrics('scroll');
        onScroll?.(e.target.scrollTop);
      },
      [handleScroll, updateMetrics, onScroll],
    );

    useEffect(() => {
      if (enableMetrics) {
        updateMetrics('render');
      }
    }, [visibleItems, enableMetrics, updateMetrics]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex,
        scrollToItem,
        scrollTop: containerRef.current?.scrollTop || 0,
        getMetrics: enableMetrics ? getMetrics : undefined,
      }),
      [scrollToIndex, scrollToItem, containerRef, enableMetrics, getMetrics],
    );

    return (
      <div
        ref={containerRef}
        className={`virtual-scroll-container ${className}`}
        style={{
          minHeight: '200px',
          contain: 'layout style',
          ...style,
        }}
        onScroll={enhancedHandleScroll}
      >
        <div
          style={{
            height: totalHeight,
            position: 'relative',
            width: '100%',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: offsetY,
              left: 0,
              right: 0,
              height: visibleItems.length * itemHeight,
            }}
          >
            {visibleItems.map((item, index) => (
              <div
                key={item.key || item.id || item.originalIndex}
                style={{
                  height: itemHeight,
                  position: 'absolute',
                  top: index * itemHeight,
                  left: 0,
                  right: 0,
                }}
              >
                {children?.({ item, index: item.originalIndex, isVisible: true })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line react-refresh/only-export-components
export function withVScroll(WrappedComponent, options = {}) {
  const WrappedWithVScroll = forwardRef((props, ref) => {
    const virtualScrollRef = useRef(null);

    useImperativeHandle(ref, () => ({
      scrollToIndex: (index) => virtualScrollRef.current?.scrollToIndex(index),
      scrollToItem: (item) => virtualScrollRef.current?.scrollToItem(item),
      scrollTop: virtualScrollRef.current?.scrollTop || 0,
    }));

    return (
      <VScroll ref={virtualScrollRef} {...options} {...props}>
        {({ item, index, isVisible }) => (
          <WrappedComponent {...props} item={item} index={index} isVisible={isVisible} />
        )}
      </VScroll>
    );
  });
  WrappedWithVScroll.displayName = `withVScroll(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
  return WrappedWithVScroll;
}

export default VScroll;
