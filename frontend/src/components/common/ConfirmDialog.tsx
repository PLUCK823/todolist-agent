import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ConfirmVariant = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: ConfirmVariant;
}

const variantButtonClasses: Record<ConfirmVariant, string> = {
  danger: "bg-[#ef4444] hover:bg-[#dc2626] focus:ring-[#ef4444]",
  warning: "bg-[#f59e0b] hover:bg-[#d97706] focus:ring-[#f59e0b]",
  info: "bg-[#7165ea] hover:bg-[#5f54d9] focus:ring-[#7165ea]",
};

const ANIMATION_DURATION = 200; // ms, must match CSS transition duration

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  variant = "danger",
}: ConfirmDialogProps) {
  // managed: whether the portal is in the DOM at all
  const [mounted, setMounted] = useState(() => isOpen);
  // animated: controls the inline style values for the CSS transition
  const [animatedIn, setAnimatedIn] = useState(() => isOpen);

  // Keep a ref of the last seen isOpen so we can detect edge transitions
  const prevOpen = useRef(isOpen);

  useEffect(() => {
    // No change -- nothing to do
    if (isOpen === prevOpen.current) return;
    prevOpen.current = isOpen;

    if (isOpen) {
      // Mount immediately so the element is in the DOM …
      setMounted(true);
      // … then flip the animation flag on the next tick so the CSS
      // transition has an initial value to transition *from*.
      // setTimeout(10) works reliably in both jsdom and real browsers;
      // requestAnimationFrame is avoided on purpose for test compat.
      const enterTimer = setTimeout(() => setAnimatedIn(true), 10);
      return () => clearTimeout(enterTimer);
    }

    // Closing: flip animation flag first (triggers exit transition) …
    setAnimatedIn(false);
    // … then unmount after the transition completes.
    const exitTimer = setTimeout(
      () => setMounted(false),
      ANIMATION_DURATION,
    );
    return () => clearTimeout(exitTimer);
  }, [isOpen]);

  // Focus trap: focus the confirm button when the dialog opens
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [isOpen]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  const handleBackdropClick = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!mounted) return null;

  const overlayStyle: React.CSSProperties = {
    opacity: animatedIn ? 1 : 0,
    transition: `opacity ${ANIMATION_DURATION}ms ease-out`,
  };

  const dialogStyle: React.CSSProperties = {
    opacity: animatedIn ? 1 : 0,
    transform: animatedIn
      ? "translateY(0) scale(1)"
      : "translateY(8px) scale(0.97)",
    transition: `opacity ${ANIMATION_DURATION}ms ease-out, transform ${ANIMATION_DURATION}ms ease-out`,
  };

  const buttonClass = variantButtonClasses[variant];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={overlayStyle}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={dialogStyle}
        onClick={handleDialogClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="p-6">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-semibold text-[#1a1a2e] mb-2"
          >
            {title}
          </h2>
          <div
            id="confirm-dialog-message"
            className="text-sm text-[#6b7280] leading-relaxed"
          >
            {message}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[#6b7280] bg-white border border-[#e5e7eb] rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#7165ea] focus:ring-offset-2 transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer ${buttonClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
