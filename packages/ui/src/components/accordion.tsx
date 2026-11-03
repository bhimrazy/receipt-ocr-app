"use client"

import * as React from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { cn } from "@receipt-ocr/ui/lib/utils"
import { Plus } from "lucide-react"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col divide-y divide-border rounded-xl border border-border", className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger flex min-h-11 flex-1 items-center justify-between gap-4 rounded-md py-5 text-left text-sm font-medium text-foreground transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <Plus
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-aria-expanded/accordion-trigger:rotate-45 group-aria-expanded/accordion-trigger:text-primary"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel data-slot="accordion-content" className="overflow-hidden text-sm" {...props}>
      <div className={cn("pb-5 leading-7 text-muted-foreground", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  )
}

/**
 * Pass `question` for the one-line FAQ form (trigger + panel built in);
 * omit it to compose AccordionTrigger / AccordionContent yourself.
 */
function AccordionItem({
  className,
  question,
  children,
  ...props
}: AccordionPrimitive.Item.Props & { question?: React.ReactNode }) {
  return (
    <AccordionPrimitive.Item data-slot="accordion-item" className={cn("px-5", className)} {...props}>
      {question === undefined ? (
        children
      ) : (
        <>
          <AccordionTrigger>{question}</AccordionTrigger>
          <AccordionContent>{children}</AccordionContent>
        </>
      )}
    </AccordionPrimitive.Item>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
