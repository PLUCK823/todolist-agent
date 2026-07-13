import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ToastContext,
  type Toast,
  type ToastContextValue,
  type ToastType,
} from "../../shared/ui/toast-context";

// --- Provider ---

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    // Actually unmount after exit animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, type, message }]);
    },
    [],
  );

  const value: ToastContextValue = { addToast, removeToast, toasts };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// --- Icon & colour config ---

const toastConfig: Record<
  ToastType,
  { icon: string; borderColor: string; textColor: string; bgColor: string }
> = {
  success: {
    icon: "✓",
    borderColor: "#10b981",
    textColor: "#065f46",
    bgColor: "#ecfdf5",
  },
  error: {
    icon: "✕",
    borderColor: "#ef4444",
    textColor: "#991b1b",
    bgColor: "#fef2f2",
  },
  warning: {
    icon: "⚠",
    borderColor: "#f59e0b",
    textColor: "#92400e",
    bgColor: "#fffbeb",
  },
  info: {
    icon: "ℹ",
    borderColor: "#7165ea",
    textColor: "#3730a3",
    bgColor: "#eef2ff",
  },
};

// --- Auto-dismiss timer per toast ---

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't start a timer for a toast that is already leaving
    if (toast.leaving) return;

    timerRef.current = setTimeout(() => {
      onRemove(toast.id);
    }, 4000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.leaving, onRemove]);

  const config = toastConfig[toast.type];

  const cardStyle: React.CSSProperties = {
    backgroundColor: config.bgColor,
    borderLeft: `4px solid ${config.borderColor}`,
    opacity: toast.leaving ? 0 : 1,
    transform: toast.leaving
      ? "translateX(100%) scale(0.95)"
      : "translateX(0) scale(1)",
    transition: "opacity 0.25s ease-out, transform 0.25s ease-out",
  };

  const iconStyle: React.CSSProperties = {
    color: config.borderColor,
  };

  const textStyle: React.CSSProperties = {
    color: config.textColor,
  };

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-sm"
      style={cardStyle}
      role="alert"
    >
      <span
        className="flex-shrink-0 flex items-center justify-center w-5 h-5 text-sm font-bold leading-none"
        style={iconStyle}
        aria-hidden="true"
      >
        {config.icon}
      </span>
      <span className="flex-1 text-sm font-medium" style={textStyle}>
        {toast.message}
      </span>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[#6b7280] hover:text-[#1a1a2e] hover:bg-black/5 transition-colors cursor-pointer"
        aria-label="关闭通知"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {"✕"}
        </span>
      </button>
    </div>
  );
}

// --- Region rendered via portal ---

interface ToastRegionProps {
  toasts: readonly Toast[];
  onRemove: (id: string) => void;
}

function ToastRegion({ toasts, onRemove }: ToastRegionProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-label="通知列表"
      data-overlay-allow-interaction
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>,
    document.body,
  );
}

export default ToastRegion;
