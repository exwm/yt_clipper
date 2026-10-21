// Clipper scripts 5.48 and older read these numbers from the saved preset and fail without them.
// Newer clipper scripts use only the preset's name.
const legacyVideoStabilizationNumbers = {
  'Very Weak': { shakiness: 2, smoothing: 2, zoomspeed: 0.05 },
  Weak: { shakiness: 4, smoothing: 4, zoomspeed: 0.1 },
  Medium: { shakiness: 6, smoothing: 6, zoomspeed: 0.2 },
  Strong: { shakiness: 8, smoothing: 10, zoomspeed: 0.3 },
  'Very Strong': { shakiness: 10, smoothing: 16, zoomspeed: 0.4 },
  Strongest: { shakiness: 10, smoothing: 22, zoomspeed: 0.5 },
};

function videoStabilizationPreset(desc: keyof typeof legacyVideoStabilizationNumbers) {
  return { desc, enabled: true, ...legacyVideoStabilizationNumbers[desc] };
}

export const presetsMap = {
  videoStabilization: {
    Disabled: { desc: 'Disabled', enabled: false },
    'Very Weak': videoStabilizationPreset('Very Weak'),
    Weak: videoStabilizationPreset('Weak'),
    Medium: videoStabilizationPreset('Medium'),
    Strong: videoStabilizationPreset('Strong'),
    'Very Strong': videoStabilizationPreset('Very Strong'),
    Strongest: videoStabilizationPreset('Strongest'),
  },
  denoise: {
    Disabled: { enabled: false, desc: 'Disabled' },
    'Very Weak': { enabled: true, lumaSpatial: 1, desc: 'Very Weak' },
    Weak: { enabled: true, lumaSpatial: 2, desc: 'Weak' },
    Medium: { enabled: true, lumaSpatial: 4, desc: 'Medium' },
    Strong: { enabled: true, lumaSpatial: 6, desc: 'Strong' },
    'Very Strong': { enabled: true, lumaSpatial: 8, desc: 'Very Strong' },
  },
};
