// Imported first by a script that must run the markup under 5.49's frame timing whatever the frame
// timing flags' defaults: frame-timing.ts reads them when it loads. The parity tables hold 5.49's
// crop ease and Cinematic cuts.
import { featureFlags } from '../../src/markup/feature-flags';

Object.assign(featureFlags, {
  placementTiming: '5.49',
  seekTiming: '5.49',
  loopTiming: '5.49',
  stepsTiming: '5.49',
  compareTiming: '5.49',
  frameRateTiming: '5.49',
  cropEaseTiming: '5.49',
  cinematicTiming: '5.49',
});
