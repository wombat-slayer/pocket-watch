import { useEffect, useRef } from 'react';

let Chart;

async function getChart() {
  if (Chart) return Chart;
  const mod = await import('chart.js/auto');
  Chart = mod.default;
  return Chart;
}

export function useChart(canvasRef, configFn, deps) {
  const instanceRef = useRef(null);
  const typeRef     = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const config = configFn();

    getChart().then(ChartClass => {
      const existing = instanceRef.current;
      if (existing && typeRef.current === config.type) {
        // In-place update — no flash
        existing.data    = config.data;
        existing.options = { ...existing.options, ...config.options };
        existing.update('none');
      } else {
        // Recreate (type changed or first mount)
        if (existing) existing.destroy();
        instanceRef.current = new ChartClass(canvasRef.current, config);
        typeRef.current = config.type;
      }
    });

    return () => {
      // Only destroy on unmount, not on dep changes
    };
  }, deps); // eslint-disable-line

  // Destroy on actual unmount
  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
  }, []); // eslint-disable-line
}
