import { useEffect, useRef } from 'react';

interface DialogAccessibilityOptions {
  open: boolean;
  onEscape?: () => void;
}

/**
 * Keeps keyboard focus within an open dialog and returns it to the
 * element that opened the dialog when the dialog closes.
 */
export function useDialogAccessibility<T extends HTMLElement = HTMLDivElement>({
  open,
  onEscape,
}: DialogAccessibilityOptions) {
  const dialogRef = useRef<T | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const getFocusableElements = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) =>
      !element.hasAttribute('hidden')
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getAttribute('aria-disabled') !== 'true'
      && element.getClientRects().length > 0,
    );

    const focusableElements = getFocusableElements();
    const initialFocus = focusableElements.find((element) =>
      element.hasAttribute('data-dialog-initial-focus'),
    );
    (initialFocus ?? focusableElements[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const elements = getFocusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement;
      const focusIsOutsideDialog = !(activeElement instanceof Node) || !dialog.contains(activeElement);

      if (event.shiftKey && (activeElement === first || focusIsOutsideDialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || focusIsOutsideDialog)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected && !previousFocus.hasAttribute('disabled')) {
        previousFocus.focus();
      }
    };
  }, [open]);

  return dialogRef;
}
