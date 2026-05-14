import { html, TemplateResult, nothing } from 'lit-html';

export interface ModalShellProps {
  id?: string;
  title: string;
  /** Plain text gets rendered via lit-html text-context (auto-escaped).
   *  A `TemplateResult` is rendered as-is — callers that need to
   *  interpolate user-controlled state should pass a template that
   *  delimits the state in `<code>` so it can't visually pretend to be
   *  modal chrome (social-engineering defense). */
  warning?: string | TemplateResult;
  children: TemplateResult;
  actions: TemplateResult;
  extraClass?: string;
  onBackdropClick?: (e: MouseEvent) => void;
}

export function ModalShell(p: ModalShellProps): TemplateResult {
  const outerClass = p.extraClass ? `ytc-modal ${p.extraClass}` : 'ytc-modal';
  return html`
    <div
      id=${p.id ?? nothing}
      class=${outerClass}
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget && p.onBackdropClick) p.onBackdropClick(e);
      }}
    >
      <div class="ytc-share-modal-box">
        <div class="ytc-share-modal-title">${p.title}</div>
        ${p.warning ? html`<div class="ytc-share-modal-warning">${p.warning}</div>` : nothing}
        ${p.children}
        <div class="ytc-share-modal-actions">${p.actions}</div>
      </div>
    </div>
  `;
}
