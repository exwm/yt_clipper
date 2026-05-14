import { stripIndent } from 'common-tags';
import { html, nothing, render, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { ModalShell } from '../components/modal';
import { copyToClipboard, deleteElement, flashMessage } from '../util/util';
import { DataFormatIssue, isDangerousIssue } from './parse-clipper-input';
import { SuspiciousHtmlFinding, scanSuspiciousContent } from './scan-suspicious-content';

const MODAL_ID = 'shared-markers-modal';

function deleteReviewModal(): void {
  const el = document.getElementById(MODAL_ID);
  if (el) deleteElement(el);
}

interface ReviewModalProps {
  title: string;
  warning: string | TemplateResult;
  findings: readonly SuspiciousHtmlFinding[];
  issues: readonly DataFormatIssue[];
  onLoad: () => void;
  onDismiss: () => void;
  onCopy: () => void;
  onBackdropClick: () => void;
}

// Populate the `<pre>` JSON preview using a single native `textContent`
// write. No lit-html interpolation, no library touches the attacker-
// controlled JSON string — absolute-safe path even against hypothetical
// library zero-days at the review stage.
function populateJsonPreview(container: Element, payload: unknown): void {
  container.textContent = JSON.stringify(payload, null, 2);
}

function joinCodeElements(keys: readonly string[]): TemplateResult {
  return html`${keys.map((k, i) => html`${i > 0 ? ', ' : ''}<code>${k}</code>`)}`;
}

function describeFormatIssue(issue: DataFormatIssue): TemplateResult {
  switch (issue.kind) {
    case 'unexpectedFields':
      return html`<code>${issue.path}</code>: removed unknown field(s) ${joinCodeElements(issue.keys)}`;
    case 'dangerousKeys':
      return html`<code>${issue.path}</code>: blocked reserved JavaScript key(s)
        ${joinCodeElements(issue.keys)} (could modify internal runtime behavior)`;
    case 'invalidPoint':
      return html`<code>${issue.path}</code>: dropped invalid point`;
  }
}

function ReviewModal(
  p: ReviewModalProps,
  bindPre: (el: Element | undefined) => void
): TemplateResult {
  const dangerousIssues = p.issues.filter(isDangerousIssue);
  const infoIssues = p.issues.filter((i) => !isDangerousIssue(i));

  // XSS-severity bucket: HTML content scan findings + dangerousKeys issues.
  const showDanger = p.findings.length > 0 || dangerousIssues.length > 0;
  const dangerSection = showDanger
    ? html`
        <div class="ytc-share-modal-findings">
          <div class="ytc-share-modal-findings-header">
            ⚠ This data contains content that could be trying to run code.
          </div>
          <div class="ytc-share-modal-findings-callout">
            If you don't trust the source of this data, cancel rather than load.
          </div>
          ${p.findings.length
            ? html`<div>
                Text that looks like executable HTML or scripts (e.g.
                <code>&lt;iframe&gt;</code>, <code>onerror=</code>, or
                <code>javascript:</code> URLs).
                <br />
                This kind of content does not belong in normal markers data and its presence
                suggests tampering. Although we do our best to treat this content as plain text and
                never execute it,
                <strong>treat the source as untrusted and prefer to cancel.</strong>
              </div>`
            : nothing}
          <ul>
            ${p.findings.map((f) => html`<li><code>${f.path}</code>: ${joinCodeElements(f.items)}</li>`)}
            ${dangerousIssues.map((issue) => html`<li>${describeFormatIssue(issue)}</li>`)}
          </ul>
        </div>
      `
    : nothing;

  // Informational bucket: fields that don't match the expected format.
  const infoSection = infoIssues.length
    ? html`
        <div class="ytc-share-modal-parse-issues">
          <div class="ytc-share-modal-parse-issues-header">
            ℹ Some fields didn't match the markers format and were cleaned up. Usually harmless
            (e.g. files from a newer version, or hand-edited JSON):
          </div>
          <ul>
            ${infoIssues.map((issue) => html`<li>${describeFormatIssue(issue)}</li>`)}
          </ul>
        </div>
      `
    : nothing;

  const body = html`
    ${dangerSection}${infoSection}
    <pre class="ytc-share-modal-json" ${ref(bindPre)}></pre>
  `;
  const actions = html`
    <input type="button" class="ytc-share-modal-copy" value="Copy JSON" @click=${p.onCopy} />
    <input type="button" class="ytc-share-modal-load" value="Load" @click=${p.onLoad} />
    <input type="button" class="ytc-share-modal-cancel" value="Cancel" @click=${p.onDismiss} />
  `;
  return ModalShell({
    id: MODAL_ID,
    extraClass: 'ytc-share-modal',
    title: p.title,
    warning: p.warning,
    children: body,
    actions,
    onBackdropClick: p.onBackdropClick,
  });
}

export interface ShowLoadMarkersReviewOptions {
  /** Modal title, e.g. `"Load shared markers?"` / `"Load markers from file?"`. */
  modalTitle: string;
  /** Warning banner content — customize per source severity. Strings are
   *  rendered via lit-html text-context (auto-escaped). Templates are
   *  rendered as-is; use a template (with `<code>` around any
   *  user-controlled state interpolation) when the warning needs to
   *  visually delimit attacker-controllable text. */
  warning: string | TemplateResult;
  /** Short label for the source used in flash messages, e.g. `"shared URL"` / `"file: x.json"`. */
  sourceLabel: string;
  /**
   * The object to show in the preview and scan for HTML-like content. The
   * preview is rendered via a single `textContent` write — no lit-html, no
   * library touches the string. Must be JSON-safe.
   */
  payload: unknown;
  /** Parser issues surfaced during the pre-review parse (unknown keys
   *  stripped, prototype keys stripped, invalid map points dropped). Shown
   *  alongside the HTML content scan in the modal body. */
  issues?: readonly DataFormatIssue[];
  /** Applies the data. Throws on failure; the modal catches + flashes. */
  onLoad: () => void;
  /** Optional additional work on dismiss (e.g. strip-from-URL). */
  onDismiss?: () => void;
}

export function showLoadMarkersReviewModal(opts: ShowLoadMarkersReviewOptions): void {
  deleteReviewModal();

  const host = document.createElement('div');
  document.body.appendChild(host);

  const findings = scanSuspiciousContent(opts.payload);

  const cleanup = (): void => {
    document.removeEventListener('keydown', onKeydown, true);
    deleteReviewModal();
    if (host.parentNode) host.parentNode.removeChild(host);
  };

  const dismiss = (): void => {
    cleanup();
    opts.onDismiss?.();
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      dismiss();
    }
  };
  document.addEventListener('keydown', onKeydown, true);

  const onLoad = (): void => {
    if (findings.length > 0) {
      const confirmed = confirm(stripIndent`
        ⚠ Data contains HTML-like markup in ${findings.length} field(s).
        Our renderer treats these as text (no execution), but they may be unexpected.
        Load anyway?
      `);
      if (!confirmed) return;
    }
    try {
      opts.onLoad();
      cleanup();
    } catch (err) {
      console.error(`Failed to apply ${opts.sourceLabel}`, err);
      flashMessage(`Failed to apply data from ${opts.sourceLabel}. See console.`, 'red');
    }
  };

  const onCopy = (): void => {
    copyToClipboard(JSON.stringify(opts.payload, null, 2));
    flashMessage('Copied JSON to clipboard.', 'green');
  };

  const bindPre = (el: Element | undefined): void => {
    if (!el) return;
    populateJsonPreview(el, opts.payload);
  };

  render(
    ReviewModal(
      {
        title: opts.modalTitle,
        warning: opts.warning,
        findings,
        issues: opts.issues ?? [],
        onLoad,
        onDismiss: dismiss,
        onCopy,
        onBackdropClick: dismiss,
      },
      bindPre
    ),
    host
  );
}
