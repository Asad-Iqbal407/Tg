const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24 stroke/fill icon paths (original, minimal designs).
const ICONS = {
  coin: {
    fill: true,
    d: [
      'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Zm-1 2.3v9h2v-9h-2Z',
    ],
  },
  gem: {
    fill: true,
    d: [
      'M6 3h12l4 6-10 12L2 9l4-6Zm1.2 2L5 8.5h4.3L10.7 5H7.2Zm5.6 0 1.4 3.5H19L16.8 5h-4Zm-2 0h2.4l-1.2 3-1.2-3ZM5.3 10.5l5.4 6.4-2.3-6.4H5.3Zm5.3 0 1.4 4.4 1.4-4.4h-2.8Zm4.9 0-2.3 6.4 5.4-6.4h-3.1Z',
    ],
  },
  play: { fill: true, d: ['M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z'] },
  pause: { fill: true, d: ['M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z'] },
  home: { fill: false, d: ['M3 11.5 12 4l9 7.5', 'M5.5 9.8V20h13V9.8', 'M10 20v-5.5h4V20'] },
  target: {
    fill: false,
    d: [
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
      'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z',
      'M12 11.2v1.6',
    ],
  },
  cart: {
    fill: false,
    d: ['M3 4h2.5l2.2 10.5h10.6L20.5 7H7', 'M9 19.5a1 1 0 1 0 0 .01', 'M17 19.5a1 1 0 1 0 0 .01'],
  },
  trophy: {
    fill: false,
    d: [
      'M8 4h8v5a4 4 0 0 1-8 0V4Z',
      'M8 6H4.5a3.5 3.5 0 0 0 3.8 4',
      'M16 6h3.5a3.5 3.5 0 0 1-3.8 4',
      'M12 13v4',
      'M8.5 20h7l-.8-3h-5.4l-.8 3Z',
    ],
  },
  chart: { fill: false, d: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'] },
  user: {
    fill: false,
    d: ['M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z', 'M4 20.5c1.4-3.6 4.5-5.5 8-5.5s6.6 1.9 8 5.5'],
  },
  settings: {
    fill: false,
    d: [
      'M12 15.3a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z',
      'M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z',
    ],
  },
  gift: {
    fill: false,
    d: [
      'M3.5 9h17v4h-17V9Z',
      'M5 13v8h14v-8',
      'M12 9v12',
      'M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9Zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9Z',
    ],
  },
  star: {
    fill: true,
    d: ['m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9L12 2.8Z'],
  },
  check: { fill: false, d: ['m5 12.5 4.5 4.5L19 7.5'] },
  close: { fill: false, d: ['M6 6l12 12', 'M18 6 6 18'] },
  lock: { fill: false, d: ['M6.5 10.5h11v10h-11v-10Z', 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3'] },
  bolt: { fill: true, d: ['M13.5 2 4 14h6.5L9.5 22 20 9.5h-6.5L13.5 2Z'] },
  shield: {
    fill: false,
    d: ['M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z', 'm8.8 12 2.2 2.2 4.4-4.4'],
  },
  rocket: {
    fill: false,
    d: [
      'M12 3c3 2 5 5.5 5 9.5l-2 3.5H9l-2-3.5C7 8.5 9 5 12 3Z',
      'M12 9.5a1.5 1.5 0 1 0 0 .01',
      'M9 16l-2.5 3.5M15 16l2.5 3.5',
      'M12 18v3',
    ],
  },
  volume: {
    fill: false,
    d: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z', 'M15.5 9a4.5 4.5 0 0 1 0 6', 'M18 6.5a8 8 0 0 1 0 11'],
  },
  mute: { fill: false, d: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z', 'M16 9.5l5 5M21 9.5l-5 5'] },
  expand: { fill: false, d: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'] },
  back: { fill: false, d: ['M15 5l-7 7 7 7'] },
  restart: { fill: false, d: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4 4.5v4h4'] },
  flag: { fill: false, d: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'] },
  calendar: { fill: false, d: ['M4 6h16v14H4V6Z', 'M4 10h16', 'M8 3.5v4M16 3.5v4'] },
  sparkle: { fill: true, d: ['M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z'] },
  download: { fill: false, d: ['M12 4v11', 'm7 10.5 5 5 5-5', 'M5 20h14'] },
  upload: { fill: false, d: ['M12 20V9', 'm7 13.5 5-5 5 5', 'M5 4h14'] },
  trash: { fill: false, d: ['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13'] },
  edit: { fill: false, d: ['M4 20h4L19 9l-4-4L4 16v4Z', 'm13.5 6.5 4 4'] },
  clock: { fill: false, d: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M12 7.5V12l3 2'] },
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const def = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of def.d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (def.fill) {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('fill-rule', 'evenodd');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}
