import { platformForHost, VideoPlatforms } from './platforms';

describe('platformForHost', () => {
  test.each([
    ['www.youtube.com', VideoPlatforms.youtube],
    ['m.youtube.com', VideoPlatforms.youtube],
    ['www.vlive.tv', VideoPlatforms.vlive],
    ['weverse.io', VideoPlatforms.weverse],
    ['tv.naver.com', VideoPlatforms.naver_tv],
    ['play.afreecatv.com', VideoPlatforms.afreecatv],
    ['exwm.github.io', VideoPlatforms.yt_clipper],
    ['localhost', VideoPlatforms.yt_clipper],
    ['127.0.0.1', VideoPlatforms.yt_clipper],
    // A host that only contains a platform's name is not that platform.
    ['vlive.evil.example', VideoPlatforms.youtube],
    ['notyoutube.com', VideoPlatforms.youtube],
    ['exwm.github.io.evil.example', VideoPlatforms.youtube],
    ['naver.com', VideoPlatforms.youtube],
  ])('%s is %s', (host, platform) => {
    expect(platformForHost(host)).toBe(platform);
  });
});
