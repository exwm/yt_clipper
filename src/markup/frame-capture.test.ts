jest.mock('./yt_clipper', () => ({
  platform: 'youtube',
  isTheatreMode: jest.fn().mockReturnValue(false),
  updateSettingsEditorHook: jest.fn(),
  initOnceCalled: false,
  shortcutRegistry: null,
  shortcutsTableStyle: '',
  shortcutsTableToggleButtonHTML: '',
}));

jest.mock('./platforms/platforms', () => ({
  getPlatform: () => 'youtube',
}));

jest.mock('./util/videoUtil', () => ({
  getFPS: jest.fn(),
}));

jest.mock('./util/util', () => ({
  safeSetInnerHtml: jest.fn(),
  flashMessage: jest.fn(),
  deleteElement: jest.fn(),
  toHHMMSSTrimmed: (t: number) => t.toFixed(2),
  getVideoDuration: jest.fn(),
}));

jest.mock('./crop-utils', () => ({
  multiplyCropString: jest.fn(),
}));

jest.mock('./crop/crop', () => ({
  Crop: { getMultipliedCropRes: jest.fn(), getCropComponents: jest.fn() },
}));

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock('jszip', () => jest.fn());

import { getFrameCount } from './frame-capture';
import { getFPS } from './util/videoUtil';
import { getVideoDuration } from './util/util';
import { appState } from './appState';

const mockGetFPS = getFPS as jest.Mock;
const mockGetVideoDuration = getVideoDuration as jest.Mock;

beforeEach(() => {
  appState.video = {} as any;
  mockGetFPS.mockReset();
  mockGetVideoDuration.mockReset();
});

describe('getFrameCount', () => {
  test.each([
    { fps: 30, duration: 100, seconds: 10, frameNumber: 300, totalFrames: 3000, desc: '30fps' },
    { fps: 60, duration: 60, seconds: 5.5, frameNumber: 330, totalFrames: 3600, desc: '60fps' },
    {
      fps: 24,
      duration: 10,
      seconds: 1.05,
      frameNumber: 25,
      totalFrames: 240,
      desc: 'floors fractional frames',
    },
    { fps: 30, duration: 60, seconds: 0, frameNumber: 0, totalFrames: 1800, desc: 'time 0' },
  ])(
    '$desc: $seconds s @ $fps fps → frame $frameNumber / $totalFrames',
    ({ fps, duration, seconds, frameNumber, totalFrames }) => {
      mockGetFPS.mockReturnValue(fps);
      mockGetVideoDuration.mockReturnValue(duration);
      expect(getFrameCount(seconds)).toEqual({ frameNumber, totalFrames });
    }
  );

  test.each([null, 0])('returns Unknown when fps is %s', (fps) => {
    mockGetFPS.mockReturnValue(fps);
    expect(getFrameCount(10)).toEqual({ frameNumber: 'Unknown', totalFrames: 'Unknown' });
  });
});
