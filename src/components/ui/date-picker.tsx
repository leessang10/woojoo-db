import * as React from "react"
import { Popover } from "radix-ui"
import { CalendarDays } from "lucide-react"
import { Calendar } from "./calendar"
import { ko, enUS } from "react-day-picker/locale"
import { useLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
function parse(value: string) { const parts = value.split("-").map(Number); return parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2]) : undefined }
function format(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}` }
export function DatePicker({ value, defaultValue, onChange, className, disabled, id, name, min, max, required, ...props }: React.ComponentProps<"input">) {
  const { language } = useLanguage()
  const [internal, setInternal] = React.useState(String(defaultValue ?? ""))
  const [open, setOpen] = React.useState(false)
  const current = String(value ?? internal)
  const selected = parse(current)
  const change = (date?: Date) => { const next = date ? format(date) : ""; setInternal(next); const target = document.createElement("input"); target.value = next; target.name = name ?? ""; onChange?.({target, currentTarget: target, type:"change"} as React.ChangeEvent<HTMLInputElement>); setOpen(false) }
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger id={id} disabled={disabled} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]} aria-required={required} className={cn("ui-select-trigger ui-date-trigger", className)} data-slot="date-picker"><span>{current || props.placeholder || "YYYY-MM-DD"}</span><CalendarDays size={14}/></Popover.Trigger><Popover.Portal><Popover.Content className="ui-control-popup ui-date-popup" sideOffset={5} align="start"><Calendar locale={language === "ko" ? ko : enUS} mode="single" selected={selected} defaultMonth={selected} onSelect={change} disabled={[...(min ? [{before: parse(String(min))!}] : []), ...(max ? [{after: parse(String(max))!}] : [])]} autoFocus/><div className="ui-calendar-footer"><button type="button" onClick={() => change()} disabled={required}>{language === "ko" ? "지우기" : "Clear"}</button><button type="button" onClick={() => change(new Date())} disabled={!!((min && format(new Date()) < min) || (max && format(new Date()) > max))}>{language === "ko" ? "오늘" : "Today"}</button></div></Popover.Content></Popover.Portal>{name && <input type="hidden" name={name} value={current}/>}</Popover.Root>
}
