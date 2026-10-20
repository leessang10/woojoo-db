import * as React from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import "./controls.css"
export function Calendar(props: React.ComponentProps<typeof DayPicker>) { return <DayPicker showOutsideDays className="ui-calendar" {...props}/> }
