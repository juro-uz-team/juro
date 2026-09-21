import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { activateDialogFocus } from "../lib/platform/dialog-focus";

// Minimal DOM port for keyboard/lifecycle checks; browser validation covers CSS visibility.
class FocusDocument extends EventTarget {
  activeElement: FocusElement | null = null;
  readonly defaultView = { getComputedStyle: (element: FocusElement) => ({ visibility: element.visibility }) };
}
class FocusElement {
  readonly children: FocusElement[] = [];
  readonly attributes = new Map<string, string>();
  parent: FocusElement | null = null;
  hidden = false;
  visibility = "visible";
  disabled = false;
  isConnected = true;
  constructor(readonly ownerDocument: FocusDocument, readonly button = true) {}
  get tabIndex() { return Number(this.attributes.get("tabindex") ?? (this.button ? 0 : -1)); }
  set tabIndex(value: number) { this.attributes.set("tabindex", String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.ownerDocument.activeElement = this; }
  matches() { return this.disabled; }
  closest(): FocusElement | null { return this.hidden ? this : this.parent?.closest() ?? null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  querySelectorAll(): FocusElement[] { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  contains(element: FocusElement | null): boolean { return this === element || this.children.some(child => child.contains(element)); }
  append(child: FocusElement) { child.parent = this; this.children.push(child); return child; }
}
function fixture(context: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FocusElement });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "HTMLElement", original);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  });
  const document = new FocusDocument(), opener = new FocusElement(document);
  const dialog = new FocusElement(document, false);
  opener.focus();
  const activate = (target: FocusElement, close: () => void) => activateDialogFocus(target as unknown as HTMLElement, { close });
  const press = (key: string, shiftKey = false) => document.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key, shiftKey }));
  return { document, opener, dialog, activate, press };
}

test("dialog keyboard focus skips hidden, disabled and untabbable controls and restores its opener", context => {
  const { document, opener, dialog, activate, press } = fixture(context);
  const first = dialog.append(new FocusElement(document));
  const hidden = dialog.append(new FocusElement(document)); hidden.hidden = true;
  const disabled = dialog.append(new FocusElement(document)); disabled.disabled = true;
  const excluded = dialog.append(new FocusElement(document)); excluded.tabIndex = -1;
  const last = dialog.append(new FocusElement(document));
  const invisible = dialog.append(new FocusElement(document)); invisible.visibility = "hidden";
  const collapsed = dialog.append(new FocusElement(document)); collapsed.visibility = "collapse";
  const dispose = activate(dialog, () => dispose());
  assert.equal(document.activeElement, first);
  last.focus(); press("Tab"); assert.equal(document.activeElement, first);
  press("Tab", true); assert.equal(document.activeElement, last);
  opener.focus(); press("Tab"); assert.equal(document.activeElement, first);
  press("Escape"); assert.equal(document.activeElement, opener);
  assert.equal(dialog.getAttribute("tabindex"), null);
  last.focus(); press("Tab"); assert.equal(document.activeElement, last, "Disposed listeners cannot trap focus");
  dispose();
});

test("nested dialogs consume one Escape and restore focus through their own openers", context => {
  const { document, opener, dialog, activate, press } = fixture(context);
  const parentControl = dialog.append(new FocusElement(document));
  let parentClosed = 0, childClosed = 0;
  const disposeParent = activate(dialog, () => { parentClosed++; disposeParent(); });
  const child = new FocusElement(document, false), childControl = child.append(new FocusElement(document));
  const disposeChild = activate(child, () => { childClosed++; disposeChild(); });
  assert.equal(document.activeElement, childControl);
  press("Escape");
  assert.equal(childClosed, 1); assert.equal(parentClosed, 0);
  assert.equal(document.activeElement, parentControl);
  press("Escape"); assert.equal(parentClosed, 1); assert.equal(document.activeElement, opener);
});

test("a dialog with no eligible controls remains focusable and preserves an existing tabindex", context => {
  const { document, dialog, activate, press } = fixture(context);
  dialog.tabIndex = -1;
  const dispose = activate(dialog, () => {});
  press("Tab"); assert.equal(document.activeElement, dialog);
  dispose(); assert.equal(dialog.getAttribute("tabindex"), "-1");
});
