import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, useSonner } from "sonner";
import { dockToast } from "@/contexts/DockToastContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Intercepts all sonner toasts on mobile and redirects to dock toast
function DockToastInterceptor() {
  const { toasts } = useSonner();
  const seenIds = useRef(new Set<string | number>());

  useEffect(() => {
    for (const t of toasts) {
      if (seenIds.current.has(t.id)) continue;
      seenIds.current.add(t.id);

      const title = typeof t.title === 'function' ? '' : (typeof t.title === 'string' ? t.title : '');
      const desc = typeof t.description === 'function' ? '' : (typeof t.description === 'string' ? t.description : '');
      const text = title || desc || '';

      if (text) {
        dockToast(text);
      }

      // Dismiss immediately so sonner never renders it
      sonnerToast.dismiss(t.id);
    }

    // Cleanup old IDs periodically
    if (seenIds.current.size > 500) {
      const arr = Array.from(seenIds.current);
      seenIds.current = new Set(arr.slice(-100));
    }
  }, [toasts]);

  return null;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // On mobile: only mount the interceptor, skip rendering sonner entirely
  if (isMobile) {
    return <DockToastInterceptor />;
  }

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

export { Toaster, sonnerToast as toast };
