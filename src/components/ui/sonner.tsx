import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      className="toaster group !z-[200]"
      toastOptions={{
        duration: 2000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-foreground group-[.toaster]:text-background group-[.toaster]:border-transparent group-[.toaster]:shadow-lg group-[.toaster]:rounded-full group-[.toaster]:px-4 group-[.toaster]:py-2.5 group-[.toaster]:text-sm group-[.toaster]:font-medium",
          description: "group-[.toast]:text-background/80",
          actionButton: "group-[.toast]:bg-background group-[.toast]:text-foreground",
          cancelButton: "group-[.toast]:bg-background/20 group-[.toast]:text-background",
          error: "group-[.toaster]:!bg-destructive group-[.toaster]:!text-destructive-foreground",
          warning: "group-[.toaster]:!bg-amber-600 group-[.toaster]:!text-white",
        },
      }}
      {...props}
    />
  );
};

// Unified toast — Sonner everywhere (mobile + desktop)
const toast = (message: string | { title?: string; description?: string }) => {
  const text = typeof message === 'string' ? message : (message.title || message.description || '');
  sonnerToast(text);
};

toast.success = (message: string) => {
  sonnerToast.success(message);
};

toast.error = (message: string) => {
  sonnerToast.error(message);
};

toast.info = (message: string) => {
  sonnerToast.info(message);
};

toast.warning = (message: string) => {
  sonnerToast.warning(message);
};

export { Toaster, toast };
