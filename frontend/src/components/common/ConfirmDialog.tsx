import {
  useState,
  useEffect,
  useRef,
  useId,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isTopOverlay, registerOverlay } from "../../shared/ui/overlay-stack";
import { useReducedMotion } from "../../features/preferences/useReducedMotion";

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
  const animationDuration = useReducedMotion() ? 1 : ANIMATION_DURATION;
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
        Math.min(10, animationDuration),
      );
      return () => clearTimeout(enterTimer);
    }

    if (shouldRender) {
      const exitTimer = setTimeout(
        () => setExitedGeneration(generation),
        animationDuration,
      );
      return () => clearTimeout(exitTimer);
    }
  }, [animationDuration, generation, props.isOpen, shouldRender]);

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
      animationDuration={animationDuration}
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
  animationDuration,
  onTransitionEnd,
}: ConfirmDialogProps & {
  phase: "entering" | "entered" | "exiting";
  animationDuration: number;
  onTransitionEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}) {
  const animatedIn = phase === "entered";
  const interactive = phase !== "exiting";
  const canDismiss = interactive && !pending;
  const effectiveConfirmDisabled = pending || confirmDisabled;
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayIdRef = useRef(Symbol("confirm-dialog"));
  const titleId = useId();
  const messageId = useId();
  const [restoreFocusTo] = useState<HTMLElement | null>(() => {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : null;
  });

  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!interactive) return
    const root = overlayRootRef.current
    const focusElement = confirmRef.current ?? dialogRef.current
    if (!root || !focusElement) return
    focusElement.focus()
    return registerOverlay({
      id: overlayIdRef.current,
      root,
      focusElement,
      restoreFocusTo,
    })
  }, [interactive, restoreFocusTo]);

  useEffect(() => {
    if (!interactive) overlayRootRef.current?.setAttribute("inert", "");
  }, [interactive]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (canDismiss && e.key === "Escape" && isTopOverlay(overlayIdRef.current)) {
        e.preventDefault();
        onCancel();
      }
    },
    [canDismiss, onCancel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleBackdropClick = useCallback(() => {
    if (canDismiss && isTopOverlay(overlayIdRef.current)) {
      onCancel();
    }
  }, [canDismiss, onCancel]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.tabIndex !== -1);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      first.focus();
    }
  };

  const overlayStyle: React.CSSProperties = {
    opacity: animatedIn ? 1 : 0,
    transition: `opacity ${animationDuration}ms ease-out`,
  };

  const dialogStyle: React.CSSProperties = {
    opacity: animatedIn ? 1 : 0,
    transform: animatedIn
      ? "translateY(0) scale(1)"
      : "translateY(8px) scale(0.97)",
    transition: `opacity ${animationDuration}ms ease-out, transform ${animationDuration}ms ease-out`,
  };

  const buttonClass = variantButtonClasses[variant];

  return createPortal(
    <div
      ref={overlayRootRef}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${interactive ? "" : "pointer-events-none"}`}
      style={overlayStyle}
      onClick={handleBackdropClick}
      role="presentation"
      aria-hidden={interactive ? undefined : true}
      inert={interactive ? undefined : true}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-md overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-overlay)] focus:outline-none"
        style={dialogStyle}
        onTransitionEnd={onTransitionEnd}
        onClick={handleDialogClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="p-6">
          <h2
            id={titleId}
            className="mb-2 text-lg font-semibold text-[var(--text)]"
          >
            {title}
          </h2>
          <div
            id={messageId}
            className="text-sm leading-relaxed text-[var(--text-secondary)]"
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
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-[background-color,border-color,color] hover:border-[var(--border-strong)] hover:bg-[var(--surface-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={interactive && !effectiveConfirmDisabled ? onConfirm : undefined}
            disabled={!interactive || effectiveConfirmDisabled}
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
