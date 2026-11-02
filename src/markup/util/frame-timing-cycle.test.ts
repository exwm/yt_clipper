// The frame decisions load on their own, in any order: none of their modules may need
// frame-timing.ts or util.ts at load, or a cycle (util.ts imports frame-timing.ts) leaves a release
// half loaded when it is the first module imported.
const MODULES = [
  './frame-timing-548',
  './frame-timing-549',
  './frame-timing-next',
  './frame-timing-releases',
  './pure-util',
  '../crop/crop-keyframe-math',
  './decisions/group',
  './decisions/keys',
  './decisions/placement',
  './decisions/seek',
  './decisions/loop',
  './decisions/steps',
  './decisions/compare',
  './decisions/rate',
  './decisions/crop-ease',
  './decisions/cinematic',
];

describe('the frame decision modules', () => {
  it.each(MODULES)('%s loads without frame-timing.ts or util.ts', (path) => {
    jest.isolateModules(() => {
      jest.doMock('./frame-timing', () => {
        throw new Error('loaded frame-timing.ts');
      });
      jest.doMock('./util', () => {
        throw new Error('loaded util.ts');
      });
      expect(() => require(path)).not.toThrow();
    });
  });

  it('fails when a release needs util.ts at load', () => {
    jest.isolateModules(() => {
      jest.doMock('./util', () => {
        throw new Error('loaded util.ts');
      });
      expect(() => require('./videoUtil')).toThrow('loaded util.ts');
    });
  });
});
