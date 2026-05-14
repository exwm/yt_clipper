import { html, TemplateResult, nothing } from 'lit-html';

export interface ModalShellProps {
  id?: string;
  title: string;
  warning?: string;
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
