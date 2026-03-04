import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, useSonner } from "sonner";
import { dockToast } from "@/contexts/DockToastContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

// Intercepts all sonner toasts on mobile and redirects to dock toast
function DockToastInterceptor() {
  const { toasts } = useSonner();
  const seenIds = useRef(new Set<string | number>());

  useEffect(() => {
    if (!isMobileDevice()) return;

    for (const t of toasts) {
      if (seenIds.current.has(t.id)) continue;
      seenIds.current.add(t.id);

      // Extract text from the toast
      const title = typeof t.title === 'function' ? '' : (typeof t.title === 'string' ? t.title : '');
      const desc = typeof t.description === 'function' ? '' : (typeof t.description === 'string' ? t.description : '');
      const text = title || desc || '';

      if (text) {
        dockToast(text);
      }

      // Dismiss sonner's version so it doesn't render
      sonnerToast.dismiss(t.id);
    }
  }, [toasts]);

  return null;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <>
      <DockToastInterceptor />
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
    </>
  );
};

// Smart toast that uses dock on mobile, sonner on desktop
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

const toast = (message: string | { title?: string; description?: string }) => {
  const text = typeof message === 'string' ? message : (message.title || message.description || '');
  
  if (isMobileDevice()) {
    dockToast(text);
  } else {
    sonnerToast(text);
  }
};

// Also provide typed versions for common toast types
toast.success = (message: string) => {
  if (isMobileDevice()) {
    dockToast(message);
  } else {
    sonnerToast.success(message);
  }
};

toast.error = (message: string) => {
  if (isMobileDevice()) {
    dockToast(message);
  } else {
    sonnerToast.error(message);
  }
};

toast.info = (message: string) => {
  if (isMobileDevice()) {
    dockToast(message);
  } else {
    sonnerToast.info(message);
  }
};

toast.warning = (message: string) => {
  if (isMobileDevice()) {
    dockToast(message);
  } else {
    sonnerToast.warning(message);
  }
};

export { Toaster, toast };
