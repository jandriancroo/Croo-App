import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & { small?: boolean }
>(({ className, small, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex p-[2px] shrink-0 cursor-pointer items-center rounded-full border-0 transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      small ? "h-5 w-9" : "h-[31px] w-[51px]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] ring-0 transition-transform data-[state=unchecked]:translate-x-0",
        small ? "h-4 w-4 data-[state=checked]:translate-x-4" : "h-[27px] w-[27px] data-[state=checked]:translate-x-5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
