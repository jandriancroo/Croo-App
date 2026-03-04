import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { dockToast } from "@/contexts/DockToastContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

// Wrap sonner toast to redirect to dock on mobile
const toast = Object.assign(
  (message: string | { title?: string; description?: string }) => {
    const text = typeof message === 'string' ? message : (message.title || message.description || '');
    if (isMobileDevice()) {
      if (text) dockToast(text);
      return 0;
    }
    return sonnerToast(typeof message === 'string' ? message : text);
  },
  {
    success: (message: string, data?: any) => {
      if (isMobileDevice()) { dockToast(message); return 0; }
      return sonnerToast.success(message, data);
    },
    error: (message: string, data?: any) => {
      if (isMobileDevice()) { dockToast(message); return 0; }
      return sonnerToast.error(message, data);
    },
    info: (message: string, data?: any) => {
      if (isMobileDevice()) { dockToast(message); return 0; }
      return sonnerToast.info(message, data);
    },
    warning: (message: string, data?: any) => {
      if (isMobileDevice()) { dockToast(message); return 0; }
      return sonnerToast.warning(message, data);
    },
    loading: (message: string, data?: any) => {
      if (isMobileDevice()) { dockToast(message); return 0; }
      return sonnerToast.loading(message, data);
    },
    dismiss: sonnerToast.dismiss,
    promise: sonnerToast.promise,
    custom: sonnerToast.custom,
    message: sonnerToast.message,
  }
);

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
