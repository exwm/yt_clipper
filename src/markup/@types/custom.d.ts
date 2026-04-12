// Re-export chart.js globals as module exports so that
// `import { Chart, ChartConfiguration, ... } from 'chart.js'` works.
// The @types/chart.js package uses `export = Chart` (UMD global),
// which doesn't support named imports. This module declaration bridges the gap.
declare module 'chart.js' {
  export default Chart;
  export {
    Chart,
  };
  export type ChartConfiguration = Chart.ChartConfiguration;
  export type ChartOptions = Chart.ChartOptions;
  export type ChartDataSets = Chart.ChartDataSets;
  export type ChartPoint = Chart.ChartPoint;
  export type ChartFontOptions = Chart.ChartFontOptions;
}

// Augment the global Chart class with plugin properties
interface Chart {
  $zoom: any;
  annotation: any;
  scales: Record<string, any>;
  renderSpeedAndCropUI: any;
}

// Augment Chart.ChartOptions with plugin options
declare namespace Chart {
  interface ChartOptions {
    annotation?: any;
    dragData?: any;
    dragY?: any;
    dragX?: any;
    dragDataRound?: any;
    dragDataRoundMultipleX?: any;
    dragDataRoundPrecisionX?: any;
    dragDataRoundMultipleY?: any;
    dragDataRoundPrecisionY?: any;
    onDragStart?: any;
    onDrag?: any;
    onDragEnd?: any;
    dragDataSort?: any;
    dragDataSortFunction?: any;
  }
  interface ChartDataSets {
    backgroundOverlayColor?: string;
  }
}

// Tampermonkey global
declare let unsafeWindow: typeof window;

// HTMLElement extension for player control show/hide
interface HTMLElement {
  originalDisplay?: string;
}

declare module '*.html' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}
