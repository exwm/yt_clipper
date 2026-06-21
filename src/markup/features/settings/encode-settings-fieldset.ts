import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { Denoise, Loop, Settings, VideoStabilization } from '../../@types/yt_clipper';
import {
  FpsMulStepper,
  LoopSelect,
  NumberInputRow,
  PresetSelect,
  SettingsFieldset,
  TernarySelect,
} from '../../components/settings';
import { Tooltips } from '../../ui/tooltips';
import { ternaryToString } from '../../util/util';
import { FieldBinder, gateHotkeys } from './settings-editor';

function renderZoomPanRow(zoomPan: { enabled: boolean; bind: FieldBinder }): TemplateResult {
  const bound = zoomPan.bind('enable-zoom-pan-input', 'enableZoomPan', 'bool');
  return html`
    <div class="settings-editor-input-div" title=${Tooltips.enableZoomPanTooltip}>
      <span>ZoomPan</span>
      <select id=${bound.id} @change=${bound.onChange} ${ref(gateHotkeys)}>
        <option ?selected=${!zoomPan.enabled}>Disabled</option>
        <option ?selected=${zoomPan.enabled}>Enabled</option>
      </select>
    </div>
  `;
}

interface EncodeSource {
  audio?: boolean;
  encodeSpeed?: number;
  crf?: number;
  targetMaxBitrate?: number;
  twoPass?: boolean;
  enableHDR?: boolean;
  gamma?: number;
  denoise?: Denoise;
  minterpFpsMultiplier?: number;
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  loop?: Loop;
  fadeDuration?: number;
}

export interface EncodeSettingsFieldsetProps {
  id: string;
  variant: 'global' | 'marker';
  display?: 'block' | 'inline' | 'inline-block' | 'flex' | 'none';
  source: EncodeSource;
  inheritFrom?: Settings;
  bind: FieldBinder;
  fpsMulSuffix?: {
    labelId: string;
    spanId: string;
    text: string;
    onChange?: (e: Event) => void;
  };
  zoomPan?: { enabled: boolean; bind: FieldBinder };
  // Extra content appended inside the legend (e.g. the relocatable toggle bar).
  legendExtra?: TemplateResult;
}

const denoiseOptions = ['Very Weak', 'Weak', 'Medium', 'Strong', 'Very Strong'];
const vidstabOptions = ['Very Weak', 'Weak', 'Medium', 'Strong', 'Very Strong', 'Strongest'];

function numericPlaceholder(inherited: number | undefined, fallback: string): string {
  return inherited != null ? String(inherited) : fallback;
}

function presetLabel(value: { desc: string } | undefined, fallback: string): string {
  return value ? `(${value.desc})` : fallback;
}

function loopLabel(value: Loop | undefined, fallback: string): string {
  return value != null ? `(${value})` : fallback;
}

export function EncodeSettingsFieldset(p: EncodeSettingsFieldsetProps): TemplateResult {
  const { source, inheritFrom, bind } = p;
  const isMarker = inheritFrom != null;

  const audioDefault = inheritFrom
    ? (ternaryToString(inheritFrom.audio) ?? '(Disabled)')
    : '(Disabled)';
  const twoPassDefault = inheritFrom
    ? (ternaryToString(inheritFrom.twoPass) ?? '(Disabled)')
    : '(Disabled)';
  const enableHDRDefault = inheritFrom
    ? (ternaryToString(inheritFrom.enableHDR) ?? '(Disabled)')
    : '(Disabled)';
  const dynamicZoomDefault = inheritFrom
    ? (ternaryToString(inheritFrom.videoStabilizationDynamicZoom) ?? '(Disabled)')
    : '(Disabled)';
  const denoiseDefault = inheritFrom
    ? presetLabel(inheritFrom.denoise, '(Disabled)')
    : '(Disabled)';
  const vidstabDefault = inheritFrom
    ? presetLabel(inheritFrom.videoStabilization, '(Disabled)')
    : '(Disabled)';
  const loopDefault = inheritFrom ? loopLabel(inheritFrom.loop, '(none)') : '(none)';

  const encodeSpeedPlaceholder = numericPlaceholder(inheritFrom?.encodeSpeed, 'Auto');
  const crfPlaceholder = numericPlaceholder(inheritFrom?.crf, 'Auto');
  const targetBitratePlaceholder = numericPlaceholder(inheritFrom?.targetMaxBitrate, 'Auto');
  const gammaPlaceholder = numericPlaceholder(inheritFrom?.gamma, '1');
  const fadeDurationPlaceholder = numericPlaceholder(inheritFrom?.fadeDuration, '0.7');

  const denoiseDesc = source.denoise?.desc ?? null;
  const vidstabDesc = source.videoStabilization?.desc ?? null;

  const legend = p.legendExtra
    ? html`<span class="settings-legend-main">Encode Settings</span>${p.legendExtra}`
    : 'Encode Settings';

  return SettingsFieldset({
    id: p.id,
    variant: p.variant,
    legend,
    legendClassExtra: p.legendExtra ? 'settings-legend-with-toggles' : undefined,
    display: p.display,
    children: html`
      ${TernarySelect({
        ...bind('audio-input', 'audio', 'ternary'),
        label: 'Audio',
        tooltip: Tooltips.audioTooltip,
        value: source.audio,
        defaultOptionLabel: audioDefault,
      })}
      ${NumberInputRow({
        ...bind('encode-speed-input', 'encodeSpeed', 'number'),
        label: 'Encode Speed (0-5)',
        value: source.encodeSpeed ?? '',
        tooltip: Tooltips.encodeSpeedTooltip,
        min: 0,
        max: 5,
        step: 1,
        placeholder: encodeSpeedPlaceholder,
        styleInfo: { minWidth: '4em' },
      })}
      ${NumberInputRow({
        ...bind('crf-input', 'crf', 'number'),
        label: 'CRF (0-63)',
        value: source.crf ?? '',
        tooltip: Tooltips.CRFTooltip,
        min: 0,
        max: 63,
        step: 1,
        placeholder: crfPlaceholder,
        styleInfo: { minWidth: '4em' },
      })}
      ${NumberInputRow({
        ...bind('target-max-bitrate-input', 'targetMaxBitrate', 'number'),
        label: isMarker ? 'Bitrate (kb/s)' : 'Target Bitrate (kb/s)',
        value: source.targetMaxBitrate ?? '',
        tooltip: Tooltips.targetBitrateTooltip,
        min: 0,
        max: isMarker ? '10e5' : '1e5',
        step: 100,
        placeholder: targetBitratePlaceholder,
        styleInfo: { minWidth: '4em' },
      })}
      ${NumberInputRow({
        ...bind('gamma-input', 'gamma', 'number'),
        label: 'Gamma (0-4)',
        value: source.gamma ?? '',
        tooltip: Tooltips.gammaTooltip,
        min: 0.01,
        max: 4.0,
        step: 0.01,
        placeholder: gammaPlaceholder,
        styleInfo: { minWidth: '4em' },
      })}
      ${TernarySelect({
        ...bind('two-pass-input', 'twoPass', 'ternary'),
        label: 'Two-Pass',
        tooltip: Tooltips.twoPassTooltip,
        value: source.twoPass,
        defaultOptionLabel: twoPassDefault,
      })}
      ${TernarySelect({
        ...bind('enable-hdr-input', 'enableHDR', 'ternary'),
        label: 'Enable HDR',
        tooltip: Tooltips.hdrTooltip,
        value: source.enableHDR,
        defaultOptionLabel: enableHDRDefault,
      })}
      ${PresetSelect({
        ...bind('denoise-input', 'denoise', 'preset'),
        label: 'Denoise',
        tooltip: Tooltips.denoiseTooltip,
        value: denoiseDesc,
        defaultOptionLabel: denoiseDefault,
        options: denoiseOptions,
        includeDisabledOption: isMarker,
      })}
      ${FpsMulStepper({
        ...bind('minterp-fps-multiplier-input', 'minterpFpsMultiplier', 'number', {
          afterChange: p.fpsMulSuffix?.onChange,
        }),
        label: 'Src FPS Multiplier',
        labelId: p.fpsMulSuffix?.labelId,
        value: source.minterpFpsMultiplier,
        tooltip: Tooltips.minterpFpsMultiplierTooltip,
        suffixSpanId: p.fpsMulSuffix?.spanId,
        suffixText: p.fpsMulSuffix?.text,
      })}
      <div class="settings-editor-input-div multi-input-div" title=${Tooltips.vidstabTooltip}>
        ${PresetSelect({
          ...bind('video-stabilization-input', 'videoStabilization', 'preset'),
          label: 'Stabilization',
          value: vidstabDesc,
          defaultOptionLabel: vidstabDefault,
          options: vidstabOptions,
          includeDisabledOption: isMarker,
          compact: true,
        })}
        ${TernarySelect({
          ...bind(
            'video-stabilization-dynamic-zoom-input',
            'videoStabilizationDynamicZoom',
            'ternary'
          ),
          label: 'Dynamic Zoom',
          tooltip: Tooltips.dynamicZoomTooltip,
          value: source.videoStabilizationDynamicZoom,
          defaultOptionLabel: dynamicZoomDefault,
          compact: true,
        })}
      </div>
      <div class="settings-editor-input-div multi-input-div" title=${Tooltips.loopTooltip}>
        ${LoopSelect({
          ...bind('loop-input', 'loop', 'inheritableString'),
          label: 'Loop',
          value: source.loop,
          defaultOptionLabel: loopDefault,
        })}
        ${NumberInputRow({
          ...bind('fade-duration-input', 'fadeDuration', 'number'),
          label: 'Fade Duration',
          value: source.fadeDuration ?? '',
          tooltip: Tooltips.fadeDurationTooltip,
          min: 0.1,
          step: 0.1,
          placeholder: fadeDurationPlaceholder,
          styleInfo: { width: '7em' },
          compact: true,
        })}
      </div>
      ${p.zoomPan ? renderZoomPanRow(p.zoomPan) : nothing}
    `,
  });
}
