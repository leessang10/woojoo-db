import * as React from "react"
import { Select as SelectPrimitive, Popover, Checkbox } from "radix-ui"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import "./controls.css"

type Props = Omit<React.ComponentProps<"select">, "size" | "ref"> & { size?: "sm" | "default" }
type Choice = { value: string; label: React.ReactNode; disabled: boolean; group?: string }
function choices(children: React.ReactNode, group?: string, disabled = false): Choice[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement(child)) return []
    const p = child.props as React.ComponentProps<"option"> & { children?: React.ReactNode }
    if (child.type === React.Fragment) return choices(p.children, group, disabled)
    if (child.type === "optgroup" || child.type === NativeSelectOptGroup) return choices(p.children, String(p.label ?? ""), disabled || !!p.disabled)
    return [{ value: String(p.value ?? text(p.children)), label: p.children, disabled: disabled || !!p.disabled, group }]
  })
}
function text(node: React.ReactNode): string { return React.Children.toArray(node).map(x => React.isValidElement(x) ? text((x.props as {children?: React.ReactNode}).children) : String(x)).join("") }

/** Select-compatible value/change API with shadcn/Radix popup controls. */
function NativeSelect({ className, size = "default", children, value, defaultValue, onChange, multiple, disabled, name, required, id, title, onBlur, onFocus, ...props }: Props) {
  const items = choices(children)
  const [internal, setInternal] = React.useState(defaultValue ?? (multiple ? [] : items[0]?.value ?? ""))
  const current = value ?? internal
  const selected = Array.isArray(current) ? current.map(String) : [String(current)]
  const empty = React.useId()
  const encode = (v: string) => v === "" ? empty : v
  const change = (values: string[]) => {
    setInternal(multiple ? values : values[0])
    // Preserve selectedOptions for existing multi-column relation editors.
    const target = document.createElement("select")
    target.multiple = !!multiple
    target.name = name ?? ""
    for (const item of items) { const option = new Option(text(item.label), item.value); target.add(option); option.selected = values.includes(item.value) }
    onChange?.({ target, currentTarget: target, type: "change", bubbles: true, preventDefault() {}, stopPropagation() {} } as React.ChangeEvent<HTMLSelectElement>)
  }
  const triggerProps = { id, title, disabled, "aria-label": props["aria-label"], "aria-labelledby": props["aria-labelledby"], "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"], "data-size": size, "data-value": selected.join(","), className: cn("ui-select-trigger", className), onBlur: onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>, onFocus: onFocus as unknown as React.FocusEventHandler<HTMLButtonElement> }
  if (multiple) return <Popover.Root><Popover.Trigger {...triggerProps} data-slot="select-trigger" aria-required={required}><span>{items.filter(item => selected.includes(item.value)).map(item => text(item.label)).join(", ") || "—"}</span><ChevronDown size={14}/></Popover.Trigger><Popover.Portal><Popover.Content className="ui-control-popup ui-multiselect" align="start" sideOffset={5} aria-label={props["aria-label"]}><div className="ui-multiselect-options">{items.map((item, i) => <React.Fragment key={`${item.value}:${i}`}>{item.group && item.group !== items[i-1]?.group && <div className="ui-select-label">{item.group}</div>}<label className="ui-multiselect-item"><Checkbox.Root className="ui-checkbox" checked={selected.includes(item.value)} disabled={item.disabled} onCheckedChange={checked => change(checked ? [...selected, item.value] : selected.filter(v => v !== item.value))}><Checkbox.Indicator><Check size={12}/></Checkbox.Indicator></Checkbox.Root><span>{item.label}</span></label></React.Fragment>)}</div></Popover.Content></Popover.Portal>{name && selected.map(v => <input key={v} type="hidden" name={name} value={v}/>)}</Popover.Root>
  return <SelectPrimitive.Root value={encode(selected[0] ?? "")} onValueChange={v => change([v === empty ? "" : v])} disabled={disabled} name={name} required={required}>
    <SelectPrimitive.Trigger {...triggerProps} data-slot="select-trigger"><SelectPrimitive.Value/><SelectPrimitive.Icon><ChevronDown size={14}/></SelectPrimitive.Icon></SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content className="ui-control-popup ui-select-content" position="popper" sideOffset={5} align="start"><SelectPrimitive.ScrollUpButton className="ui-select-scroll"><ChevronUp size={14}/></SelectPrimitive.ScrollUpButton><SelectPrimitive.Viewport>{items.map((item, i) => <React.Fragment key={`${item.value}:${i}`}>{item.group && item.group !== items[i-1]?.group && <div className="ui-select-label">{item.group}</div>}<SelectPrimitive.Item className="ui-select-item" value={encode(item.value)} data-value={item.value} disabled={item.disabled}><SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator><Check size={14}/></SelectPrimitive.ItemIndicator></SelectPrimitive.Item></React.Fragment>)}</SelectPrimitive.Viewport><SelectPrimitive.ScrollDownButton className="ui-select-scroll"><ChevronDown size={14}/></SelectPrimitive.ScrollDownButton></SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
function NativeSelectOption(props: React.ComponentProps<"option">) { return <option {...props}/> }
function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">) { return <optgroup {...props}/> }
export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
