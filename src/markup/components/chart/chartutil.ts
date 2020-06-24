import { getRounder } from '../../util';
export const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

export const lightgrey = (opacity: number) => `rgba(120, 120, 120, ${opacity})`;
export const medgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
export const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

export const cubicInOutTension = 0.6;

export const roundX = getRounder(0.01, 2);
export const roundY = getRounder(0.05, 2);

export let inputId: string = null;
export function setInputId(Id: string) {
  inputId = Id;
}
export function getInputUpdater(inputId) {
  return function (newValue?: string | number) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    if (input) {
      if (newValue != null) {
        if (typeof newValue !== 'string') newValue = newValue.toString();
        input.value = newValue;
      }
      input.dispatchEvent(new Event('change'));
    } else {
      console.log(`Input with Id ${inputId} not found.`);
    }
  };
}
