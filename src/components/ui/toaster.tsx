import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { dockToast } from "@/contexts/DockToastContext";

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const [isMobile, setIsMobile] = useState(false);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // On mobile, intercept shadcn toasts and redirect to dock
  useEffect(() => {
    if (!isMobile) return;
    for (const t of toasts) {
      if (seenIds.current.has(t.id)) continue;
      seenIds.current.add(t.id);
      const text = typeof t.title === 'string' ? t.title : (typeof t.description === 'string' ? t.description : '');
      if (text) {
        dockToast(text);
      }
      dismiss(t.id);
    }
  }, [toasts, isMobile, dismiss]);

  // Don't render the radix toast viewport on mobile
  if (isMobile) return null;

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
