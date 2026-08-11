import { escapeHtml } from "../core/dom";

export interface UiSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface UiSelectOptions {
  id: string;
  value?: string;
  options?: UiSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}

const handlers = new Map<string, (value: string) => void>();

export function renderUiSelectHtml({
  id,
  value = "",
  options = [],
  disabled = false,
  placeholder = "请选择",
  onChange,
}: UiSelectOptions): string {
  if (onChange) handlers.set(id, onChange);
  else handlers.delete(id);

  const selected = options.find((item) => String(item.value) === String(value));
  const label = selected?.label || placeholder;
  const optionsHtml = options.length
    ? options.map((item) => {
        const active = String(item.value) === String(value);
        const description = item.description
          ? `<span class="ui-select-option-description">${escapeHtml(item.description)}</span>`
          : "";
        return `
          <button
            type="button"
            class="ui-select-option${active ? " is-active" : ""}"
            role="option"
            data-value="${escapeHtml(String(item.value))}"
            onclick='chooseUiSelectOption(${JSON.stringify(id)}, ${JSON.stringify(String(item.value))}, event)'>
            <span class="ui-select-option-copy">
              <span class="ui-select-option-title">${escapeHtml(item.label)}</span>
              ${description}
            </span>
            <span class="ui-select-check" aria-hidden="true">${active ? "✓" : ""}</span>
          </button>
        `;
      }).join("")
    : `<div class="ui-select-empty">${escapeHtml(placeholder || "暂无选项")}</div>`;

  return `
    <div
      class="ui-select-dropdown${disabled ? " is-disabled" : ""}"
      id="ui-select-${escapeHtml(id)}"
      data-ui-select-id="${escapeHtml(id)}">
      <button
        type="button"
        class="ui-select-trigger media-gen-form-control"
        ${disabled ? "disabled" : ""}
        aria-expanded="false"
        aria-haspopup="listbox"
        onclick='toggleUiSelect(${JSON.stringify(id)}, event)'>
        <span class="ui-select-label">${escapeHtml(label)}</span>
        <svg class="ui-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="ui-select-popover" role="listbox">${optionsHtml}</div>
    </div>
  `;
}

export function closeUiSelects(exceptId = ""): void {
  document.querySelectorAll<HTMLElement>(".ui-select-dropdown.is-open")
    .forEach((dropdown) => {
      if (exceptId && dropdown.dataset.uiSelectId === exceptId) return;
      dropdown.classList.remove("is-open");
      dropdown.querySelector(".ui-select-trigger")
        ?.setAttribute("aria-expanded", "false");
    });
}

export function toggleUiSelect(id: string, event?: Event): void {
  event?.stopPropagation();
  const dropdown = document.getElementById(`ui-select-${id}`);
  if (!dropdown || dropdown.classList.contains("is-disabled")) return;
  const trigger = dropdown.querySelector<HTMLButtonElement>(".ui-select-trigger");
  if (trigger?.disabled) return;

  const shouldOpen = !dropdown.classList.contains("is-open");
  closeUiSelects(id);
  (window as any).closeAddNodeMenus?.();
  (window as any).closeAllCtxWindowMenus?.();
  (window as any).closeAllCtxVisionMenus?.();
  dropdown.classList.toggle("is-open", shouldOpen);
  trigger?.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  if (shouldOpen) {
    dropdown.querySelector<HTMLElement>(
      ".ui-select-option.is-active, .ui-select-option",
    )?.focus();
  }
}

export function chooseUiSelectOption(
  id: string,
  value: string,
  event?: Event,
): void {
  event?.stopPropagation();
  const dropdown = document.getElementById(`ui-select-${id}`);
  if (dropdown) {
    const label = dropdown.querySelector<HTMLElement>(".ui-select-label");
    dropdown.querySelectorAll<HTMLElement>(".ui-select-option")
      .forEach((option) => {
        const active = option.dataset.value === String(value);
        option.classList.toggle("is-active", active);
        const check = option.querySelector<HTMLElement>(".ui-select-check");
        if (check) check.textContent = active ? "✓" : "";
        if (active && label) {
          label.textContent = option.querySelector(
            ".ui-select-option-title",
          )?.textContent || "";
        }
      });
  }
  closeUiSelects();
  handlers.get(id)?.(value);
}

(window as any).closeUiSelects = closeUiSelects;
(window as any).toggleUiSelect = toggleUiSelect;
(window as any).chooseUiSelectOption = chooseUiSelectOption;
