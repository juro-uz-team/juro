"use client";

import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

type Option = { value: string; label: ReactNode; disabled?: boolean };

function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return readOptions(child.props.children);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: child.props.disabled }];
  });
}

/** Shared single-choice field. The native select retains form values and real change events. */
export function Select({ children, value, defaultValue, onChange, className = "", id, style, displayValue, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { displayValue?: ReactNode }) {
  const options = readOptions(children);
  const initialValue = String(defaultValue ?? options.find(option => !option.disabled)?.value ?? "");
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const [validationMessage, setValidationMessage] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const validationId = useId();
  const selectedValue = String(value ?? uncontrolledValue);
  const selected = options.find(option => option.value === selectedValue) ?? options.find(option => !option.disabled);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resettingRef = useRef(false);

  useEffect(() => {
    const form = nativeRef.current?.form;
    const reset = (event: Event) => {
      resettingRef.current = true;
      // The browser resets native fields after dispatching reset; synchronize afterwards.
      window.setTimeout(() => {
        resettingRef.current = false;
        if (event.defaultPrevented) return;
        setValidationMessage("");
        if (value === undefined) setUncontrolledValue(initialValue);
        if (nativeRef.current) nativeRef.current.value = String(value ?? initialValue);
      });
    };
    form?.addEventListener("reset", reset, true);
    return () => form?.removeEventListener("reset", reset, true);
  }, [value, initialValue, props.form]);

  function choose(encodedValue: string) {
    const native = nativeRef.current;
    if (!native || resettingRef.current) return;
    // Prefix every value so that even an empty option is selectable in Radix.
    native.value = encodedValue.slice(1);
    native.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return <>
    <Primitive.Root value={`v${selected?.value ?? ""}`} onValueChange={choose} disabled={props.disabled}
      onOpenChange={open => {
        if (open) setPortalContainer(triggerRef.current?.closest<HTMLElement>('dialog, [role="dialog"]') ?? null);
      }}>
      <Primitive.Trigger ref={triggerRef} id={id} className={`juro-select ${className}`} style={style}
        aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]}
        aria-describedby={[props["aria-describedby"], validationMessage ? validationId : undefined].filter(Boolean).join(" ") || undefined}
        aria-invalid={validationMessage ? true : props["aria-invalid"]}
        aria-required={props.required} aria-busy={props["aria-busy"]} title={props.title}
        autoFocus={props.autoFocus} tabIndex={props.tabIndex}>
        <Primitive.Value>{displayValue ?? selected?.label ?? ""}</Primitive.Value>
        <Primitive.Icon asChild><ChevronDown aria-hidden="true" /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal container={portalContainer}>
        <Primitive.Content className="juro-select-menu" position="popper" sideOffset={6} collisionPadding={12}>
          <Primitive.ScrollUpButton className="juro-select-scroll"><ChevronUp aria-hidden="true" /></Primitive.ScrollUpButton>
          <Primitive.Viewport className="juro-select-options">
            {options.map(option => <Primitive.Item className="juro-select-option" key={option.value} value={`v${option.value}`} disabled={option.disabled}>
              <Primitive.ItemText>{option.label}</Primitive.ItemText>
              <Primitive.ItemIndicator className="juro-select-check"><Check aria-hidden="true" /></Primitive.ItemIndicator>
            </Primitive.Item>)}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="juro-select-scroll"><ChevronDown aria-hidden="true" /></Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
    <select {...props} ref={nativeRef} className="juro-select-native" aria-hidden="true" tabIndex={-1}
      value={selected?.value ?? ""} onFocus={() => triggerRef.current?.focus()}
      onInvalid={event => { event.preventDefault(); setValidationMessage(event.currentTarget.validationMessage); triggerRef.current?.focus(); props.onInvalid?.(event); }}
      onChange={event => { setValidationMessage(""); if (value === undefined) setUncontrolledValue(event.target.value); onChange?.(event); }}>
      {children}
    </select>
    {validationMessage && <span id={validationId} className="juro-select-error" role="alert">{validationMessage}</span>}
  </>;
}
