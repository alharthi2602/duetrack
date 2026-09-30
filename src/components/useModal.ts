import { useEffect, useRef } from "react";
export function useModal(open: boolean | string, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const dialog = document.querySelector<HTMLElement>(
      '.overlay [role="dialog"]',
    );
    if (!dialog) return;
    const before = document.activeElement as HTMLElement;
    const background = [
      ...document.querySelectorAll<HTMLElement>("main,.sidebar,.mobile-nav"),
    ];
    background.forEach((el) => (el.inert = true));
    const controls = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href]',
      ),
    ];
    (
      dialog.querySelector<HTMLElement>("[autofocus]") || controls()[0]
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const all = controls(),
          first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      background.forEach((el) => (el.inert = false));
      document.removeEventListener("keydown", key);
      if (before?.isConnected) before.focus();
    };
  }, [open]);
}
