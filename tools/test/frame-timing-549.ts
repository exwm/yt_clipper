// Imported first by a script that must run the markup on 5.49's whole frame timing whatever the
// flags' defaults: frame-timing.ts reads them when it loads. The parity tables hold 5.49's crop ease
// and Cinematic cuts.
import { featureFlags } from '../../src/markup/feature-flags';

featureFlags.frameTiming549 = true;
