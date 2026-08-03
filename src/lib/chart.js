/**
 * A small inline-SVG line chart, for trends over a series of days.
 *
 * SVG rather than the div-and-height trick the revenue bars use: a line needs
 * points joined, and a scaled path is the honest way to draw one. No library —
 * the whole app ships as one bundle and a charting dependency would be larger
 * than everything else in it.
 *
 *   lineChart([{ day, value }], { label, format })
 *
 * A single point still draws (as a dot): "sold once, on this day" is a real
 * answer, and an empty box would look like a bug.
 */
import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 320;   // viewBox units; the SVG scales to its container
const H = 90;
const PAD = 6;

function svgEl(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
  return node;
}

export function lineChart(points, opts) {
  const options = opts || {};
  const fmt = options.format || ((v) => String(v));
  const data = (points || []).filter((p) => p && isFinite(Number(p.value)));

  if (!data.length) {
    return el('p', { class: 'note chart-empty' }, options.emptyMsg || 'No activity yet.');
  }

  const values = data.map((p) => Number(p.value));
  const max = Math.max(...values);
  // Baseline at zero, not at the minimum: a series wandering between 9 and 10
  // is nearly flat, and a chart floored at its own minimum would draw it as a
  // mountain range.
  const top = max > 0 ? max : 1;
  const stepX = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0;
  const xy = (v, i) => [
    PAD + (data.length > 1 ? i * stepX : (W - PAD * 2) / 2),
    H - PAD - (Number(v) / top) * (H - PAD * 2),
  ];

  const coords = values.map(xy);
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + W + ' ' + H, class: 'line-chart',
    preserveAspectRatio: 'none', role: 'img',
    'aria-label': (options.label || 'Trend') + ' — peak ' + fmt(max),
  });

  // Filled area under the line, so a short series still reads as a shape.
  if (coords.length > 1) {
    const area = coords.map(([x, y]) => x + ',' + y).join(' ');
    svg.appendChild(svgEl('polygon', {
      class: 'line-chart-area',
      points: PAD + ',' + (H - PAD) + ' ' + area + ' ' + coords[coords.length - 1][0] + ',' + (H - PAD),
    }));
    svg.appendChild(svgEl('polyline', {
      class: 'line-chart-line', points: area, fill: 'none',
    }));
  }

  // A dot per day, each carrying its own readout on hover.
  coords.forEach(([x, y], i) => {
    const dot = svgEl('circle', { class: 'line-chart-dot', cx: x, cy: y, r: coords.length > 40 ? 1.5 : 2.5 });
    const title = document.createElementNS(NS, 'title');
    title.textContent = data[i].day + ': ' + fmt(values[i]);
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  return el('div', { class: 'line-chart-wrap' }, [
    svg,
    el('div', { class: 'line-chart-axis' }, [
      el('span', {}, String(data[0].day || '')),
      el('span', { class: 'line-chart-peak' }, 'peak ' + fmt(max)),
      el('span', {}, String(data[data.length - 1].day || '')),
    ]),
  ]);
}
