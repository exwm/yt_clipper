// Imported first by a script that must run the markup under 5.49's frame timing whatever the
// `legacyFrameTiming` default: frame-timing.ts reads the flag when it loads.
import { featureFlags } from '../../src/markup/feature-flags';

featureFlags.legacyFrameTiming = false;
