import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      duration={2000}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-foreground group-[.toaster]:text-background group-[.toaster]:border-transparent group-[.toaster]:shadow-md group-[.toaster]:rounded-full group-[.toaster]:px-4 group-[.toaster]:py-2 group-[.toaster]:text-sm group-[.toaster]:font-medium",
          description: "group-[.toast]:text-background/80",
          actionButton: "group-[.toast]:bg-background group-[.toast]:text-foreground",
          cancelButton: "group-[.toast]:bg-background/20 group-[.toast]:text-background",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
