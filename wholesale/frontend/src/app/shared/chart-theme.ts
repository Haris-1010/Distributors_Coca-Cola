import { ChartConfiguration } from 'chart.js';

/** One single-series bar chart look used across the app: thin rounded bars, recessive grid, hover tooltip. */
export function barOptions(opts: { horizontal?: boolean; money?: boolean; symbol?: string } = {}): ChartConfiguration<'bar'>['options'] {
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--app-muted').trim() || '#5f6b7a';
  const grid = css.getPropertyValue('--app-border').trim() || '#e3e7ee';
  const fmt = (v: number) => opts.money ? `${opts.symbol ?? 'Rs'} ${Number(v).toLocaleString('en-PK', { maximumFractionDigits: 0 })}` : Number(v).toLocaleString('en-PK');
  const valueAxis = { grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: (v: string | number) => fmt(Number(v)) } };
  const catAxis = { grid: { display: false }, border: { color: grid }, ticks: { color: muted, autoSkip: true, maxRotation: 0 } };
  return {
    indexAxis: opts.horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => fmt(Number(opts.horizontal ? ctx.parsed.x : ctx.parsed.y)) } },
    },
    scales: opts.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

export function barDataset(label: string, data: number[], color = '#0b4a8f') {
  return { label, data, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 28, categoryPercentage: 0.8, barPercentage: 0.9 };
}
