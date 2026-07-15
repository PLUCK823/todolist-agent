import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../ToastRegion";
import { useToast } from "../../../shared/ui/toast-context";
import { Dialog } from "../../../shared/ui/Dialog";

// ---------------------------------------------------------------------------
// Helper component that exposes toast actions for testing
// ---------------------------------------------------------------------------

function ToastTester() {
  const { addToast, removeToast, toasts } = useToast();
  return (
    <div>
      <span data-testid="toast-count">{toasts.length}</span>
      <button
        data-testid="add-success"
        onClick={() => addToast("success", "操作成功")}
      >
        Add Success
      </button>
      <button
        data-testid="add-error"
        onClick={() => addToast("error", "操作失败")}
      >
        Add Error
      </button>
      <button
        data-testid="add-warning"
        onClick={() => addToast("warning", "请注意")}
      >
        Add Warning
      </button>
      <button
        data-testid="add-info"
        onClick={() => addToast("info", "提示信息")}
      >
        Add Info
      </button>
      <button
        data-testid="remove-last"
        onClick={() => {
          if (toasts.length > 0) {
            removeToast(toasts[toasts.length - 1].id);
          }
        }}
      >
        Remove Last
      </button>
    </div>
  );
}

function renderToastApp() {
  return render(
    <ToastProvider>
      <ToastTester />
    </ToastProvider>,
  );
}

function ToastDialogHarness() {
  const [open, setOpen] = useState(false);
  const { addToast } = useToast();
  return <>
    <button type="button" onClick={() => addToast("info", "背景通知")}>先显示通知</button>
    <button type="button" onClick={() => setOpen(true)}>打开测试弹窗</button>
    <Dialog open={open} title="测试弹窗" onOpenChange={setOpen}>
      <button type="button" onClick={() => addToast("success", "弹窗通知")}>弹窗内通知</button>
    </Dialog>
  </>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToastRegion", () => {
  describe("context boundary", () => {
    it("throws when useToast is used outside ToastProvider", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => render(<ToastTester />)).toThrow(
        "useToast must be used within a <ToastProvider>",
      );
      spy.mockRestore();
    });
  });

  describe("add and display toasts", () => {
    it("adds a success toast and displays it", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByText("操作成功")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("shows correct toast count after adding multiple toasts", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      await userEvent.click(screen.getByTestId("add-error"));
      expect(screen.getByTestId("toast-count").textContent).toBe("2");
    });

    it("stacks multiple toasts", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      await userEvent.click(screen.getByTestId("add-error"));
      await userEvent.click(screen.getByTestId("add-warning"));
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(3);
    });
  });

  describe("icon and styling per type", () => {
    it("renders success toast with green border", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      const alert = screen.getByRole("alert");
      expect(alert.style.borderLeftColor).toBe("rgb(16, 185, 129)");
    });

    it("renders error toast with red border", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-error"));
      const alert = screen.getByRole("alert");
      expect(alert.style.borderLeftColor).toBe("rgb(239, 68, 68)");
    });

    it("renders warning toast with amber border", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-warning"));
      const alert = screen.getByRole("alert");
      expect(alert.style.borderLeftColor).toBe("rgb(245, 158, 11)");
    });

    it("renders info toast with primary purple border", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-info"));
      const alert = screen.getByRole("alert");
      expect(alert.style.borderLeftColor).toBe("rgb(113, 101, 234)");
    });
  });

  describe("accessibility", () => {
    it("renders toasts with role=alert", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("uses the alert role as a single live-region semantic", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByRole("alert")).not.toHaveAttribute("aria-live");
    });

    it("keeps a pre-existing toast portal interactive when a dialog opens", async () => {
      const view = render(<ToastProvider><ToastDialogHarness /></ToastProvider>);
      await userEvent.click(screen.getByRole("button", { name: "先显示通知" }));
      const region = screen.getByLabelText("通知列表");
      await userEvent.click(screen.getByRole("button", { name: "打开测试弹窗" }));
      expect(region).toHaveAttribute("data-overlay-allow-interaction");
      expect(region).not.toHaveAttribute("inert");
      expect(view.container).toHaveAttribute("inert");
    });

    it("keeps a toast portal created after a dialog out of the inert background", async () => {
      const view = render(<ToastProvider><ToastDialogHarness /></ToastProvider>);
      await userEvent.click(screen.getByRole("button", { name: "打开测试弹窗" }));
      await userEvent.click(screen.getByRole("button", { name: "弹窗内通知" }));
      const region = screen.getByLabelText("通知列表");
      expect(region).toHaveAttribute("data-overlay-allow-interaction");
      expect(region).not.toHaveAttribute("inert");
      expect(view.container).toHaveAttribute("inert");
    });
  });

  // --- Groups that need fake timers ---
  // userEvent v14 + fake timers can hang, so for these groups we use
  // fireEvent-style interactions (wrapped in act) where necessary, or
  // we advance timers immediately after each click.

  describe("remove toasts (with fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("removes a toast when removeToast is called", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByText("操作成功")).toBeInTheDocument();

      await userEvent.click(screen.getByTestId("remove-last"));

      // After the exit animation (300ms), the toast should be gone
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(screen.queryByText("操作成功")).not.toBeInTheDocument();
    });

    it("removes a toast when its close button is clicked", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByText("操作成功")).toBeInTheDocument();

      const closeButton = screen.getByLabelText("关闭通知");
      await userEvent.click(closeButton);

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(screen.queryByText("操作成功")).not.toBeInTheDocument();
    });

    it("does not retain the JS exit delay when motion is reduced", async () => {
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      await userEvent.click(screen.getByTestId("remove-last"));

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText("操作成功")).not.toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });

  describe("auto-dismiss (with fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-dismisses a toast after 4 seconds", async () => {
      renderToastApp();
      await userEvent.click(screen.getByTestId("add-success"));
      expect(screen.getByText("操作成功")).toBeInTheDocument();

      // Advance close to but not past 4 seconds
      act(() => {
        vi.advanceTimersByTime(3900);
      });
      expect(screen.getByText("操作成功")).toBeInTheDocument();

      // Cross the 4-second mark + exit animation (300ms)
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText("操作成功")).not.toBeInTheDocument();
    });
  });
});
