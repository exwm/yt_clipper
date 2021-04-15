import { Chart, ChartOptions } from 'chart.js';

declare module 'chart.js' {
  interface ChartOptions {
    [index: string]: any;
  }
}
