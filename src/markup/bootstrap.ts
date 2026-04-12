import { appState } from './appState';
import { VideoPlatforms } from './platforms/platforms';
import { retryUntilTruthyResult, getVideoDuration } from './util/util';
import { selectors, platform } from './yt_clipper';

export async function resolvePlayerAndVideo() {
  appState.player = await retryUntilTruthyResult(() => document.querySelector(selectors.player));
  if (platform === VideoPlatforms.yt_clipper) {
    appState.video = await retryUntilTruthyResult(() => document.querySelector(selectors.video));
    appState.player = await retryUntilTruthyResult(() => document.querySelector(selectors.player));
  } else {
    appState.video = await retryUntilTruthyResult(() => appState.player.querySelector(selectors.video)
    );
  }

  await retryUntilTruthyResult(() => appState.video.readyState != 0);
  await retryUntilTruthyResult(
    () => appState.video.videoWidth *
      appState.video.videoHeight *
      getVideoDuration(platform, appState.video)
  );
  if (platform === 'vlive') {
    await retryUntilTruthyResult(() => !appState.video.src.startsWith('data:video'));
    await retryUntilTruthyResult(
      () => appState.video.videoWidth *
        appState.video.videoHeight *
        getVideoDuration(platform, appState.video)
    );
  }
  appState.video.classList.add('yt-clipper-video');
}
