import { Chart, ChartOptions } from './chart.js.js';

declare module 'chart.js' {
  interface ChartOptions {
    [index: string]: any;
  }
}
