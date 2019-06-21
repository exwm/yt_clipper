import { ChartConfiguration, ChartOptions } from 'chart.js';

declare module 'chart.js' {
  interface ChartConfiguration {
    currentSpeedMap: ChartPoint[];
  }

  interface ChartOptions {
    [index: string]: any;
  }
}
