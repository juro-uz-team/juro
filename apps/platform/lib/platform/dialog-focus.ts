const activeDialogs = new WeakMap<Document, HTMLElement[]>();
const focusableSelector = 'a[href],button,input,select,textarea,[tabindex]';

/** Only the top dialog handles keys, including when a citation opens over a sheet. */
export function activateDialogFocus(dialog: HTMLElement, options: {
  close: () => void;
  initialFocus?: HTMLElement | null;
  returnFocus?: HTMLElement | null;
}): () => void {
  const document = dialog.ownerDocument;
  const previous = options.returnFocus ?? document.activeElement;
  const stack = activeDialogs.get(document) ?? [];
  activeDialogs.set(document, stack);
  stack.push(dialog);
  const visible = (element: HTMLElement) => {
    const visibility = document.defaultView?.getComputedStyle(element).visibility;
    return visibility !== 'hidden' && visibility !== 'collapse'
      && !element.closest('[hidden],[inert]') && !element.matches(':disabled')
      && element.getClientRects().length > 0;
  };
  const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 && visible(element));
  const originalTabIndex = dialog.getAttribute('tabindex');
  if (originalTabIndex === null) dialog.tabIndex = -1;
  const initial = options.initialFocus;
  (initial && dialog.contains(initial) && visible(initial) ? initial : controls()[0] ?? dialog).focus();
  const onKey = (event: KeyboardEvent) => {
    if (stack.at(-1) !== dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const available = controls(), first = available[0], last = available.at(-1);
    const current = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (!dialog.contains(current) || current === dialog
      || (event.shiftKey ? current === first : current === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const wasTop = stack.at(-1) === dialog;
    stack.splice(stack.lastIndexOf(dialog), 1);
    document.removeEventListener('keydown', onKey);
    if (originalTabIndex === null) dialog.removeAttribute('tabindex');
    if (wasTop && previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
}
