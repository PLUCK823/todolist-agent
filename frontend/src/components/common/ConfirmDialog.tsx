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
  confirmDisabled?: boolean;
  pending?: boolean;
}

const variantButtonClasses: Record<ConfirmVariant, string> = {
  danger: "bg-[#ef4444] hover:bg-[#dc2626] focus:ring-[#ef4444]",
  warning: "bg-[#f59e0b] hover:bg-[#d97706] focus:ring-[#f59e0b]",
  info: "bg-[#7165ea] hover:bg-[#5f54d9] focus:ring-[#7165ea]",
};

const ANIMATION_DURATION = 200;

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const [openCycle, setOpenCycle] = useState(() => ({
    isOpen: props.isOpen,
    generation: props.isOpen ? 1 : 0,
  }));
  if (openCycle.isOpen !== props.isOpen) {
    setOpenCycle({
      isOpen: props.isOpen,
      generation: props.isOpen
        ? openCycle.generation + 1
        : openCycle.generation,
    });
  }

  const generation = openCycle.generation;
  const [enteredGeneration, setEnteredGeneration] = useState(0);
  const [exitedGeneration, setExitedGeneration] = useState(0);
  const shouldRender = props.isOpen || exitedGeneration !== generation;

  useEffect(() => {
    if (props.isOpen) {
      const enterTimer = setTimeout(
        () => setEnteredGeneration(generation),
        10,
      );
      return () => clearTimeout(enterTimer);
    }

    if (shouldRender) {
      const exitTimer = setTimeout(
        () => setExitedGeneration(generation),
        ANIMATION_DURATION,
      );
      return () => clearTimeout(exitTimer);
    }
  }, [generation, props.isOpen, shouldRender]);

  if (!shouldRender) return null;

  const phase = props.isOpen && enteredGeneration === generation
    ? "entered"
    : props.isOpen
      ? "entering"
      : "exiting";

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (
      phase === "exiting" &&
      event.target === event.currentTarget &&
      event.propertyName === "opacity"
    ) {
      setExitedGeneration(generation);
    }
  };

  return (
    <ConfirmDialogContent
      {...props}
      phase={phase}
      onTransitionEnd={handleTransitionEnd}
    />
  );
}

function ConfirmDialogContent({
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  variant = "danger",
  confirmDisabled = false,
  pending = false,
  phase,
  onTransitionEnd,
}: ConfirmDialogProps & {
  phase: "entering" | "entered" | "exiting";
  onTransitionEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}) {
  const animatedIn = phase === "entered";
  const interactive = phase !== "exiting";
  const canDismiss = interactive && !pending;
  const [restoreFocusTo] = useState<HTMLElement | null>(() => {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : null;
  });

  // Focus trap: focus the confirm button when the dialog opens
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    return () => restoreFocusTo?.focus();
  }, [restoreFocusTo]);

  useEffect(() => {
    if (phase === "exiting") {
      restoreFocusTo?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [phase, restoreFocusTo]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (canDismiss && e.key === "Escape") {
        onCancel();
      }
    },
    [canDismiss, onCancel],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [handleKeyDown]);

  const handleBackdropClick = useCallback(() => {
    if (canDismiss) {
      onCancel();
    }
  }, [canDismiss, onCancel]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

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
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${interactive ? "" : "pointer-events-none"}`}
      style={overlayStyle}
      onClick={handleBackdropClick}
      role="presentation"
      aria-hidden={interactive ? undefined : true}
      inert={interactive ? undefined : true}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={dialogStyle}
        onTransitionEnd={onTransitionEnd}
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
            onClick={canDismiss ? onCancel : undefined}
            disabled={!canDismiss}
            aria-busy={pending || undefined}
            className="px-4 py-2 text-sm font-medium text-[#6b7280] bg-white border border-[#e5e7eb] rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#7165ea] focus:ring-offset-2 transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={interactive && !confirmDisabled ? onConfirm : undefined}
            disabled={!interactive || confirmDisabled}
            aria-busy={pending || undefined}
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
