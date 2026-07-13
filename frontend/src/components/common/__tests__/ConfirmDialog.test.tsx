import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "../ConfirmDialog";

function renderDialog(
  props: Partial<Parameters<typeof ConfirmDialog>[0]> = {},
) {
  const defaultProps = {
    isOpen: true,
    title: "删除任务",
    message: "确定要删除这个任务吗？此操作不可撤销。",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
  const merged = { ...defaultProps, ...props };
  const renderResult = render(<ConfirmDialog {...merged} />);
  return { ...merged, ...renderResult };
}

describe("ConfirmDialog", () => {
  describe("render behaviour", () => {
    it("renders the dialog when isOpen is true", () => {
      renderDialog({ isOpen: true });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("does not render the dialog when isOpen is false", () => {
      renderDialog({ isOpen: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders the title and message", () => {
      renderDialog({
        title: "确认操作",
        message: "这是一条测试消息",
      });
      expect(screen.getByText("确认操作")).toBeInTheDocument();
      expect(screen.getByText("这是一条测试消息")).toBeInTheDocument();
    });

    it("renders default button labels", () => {
      renderDialog();
      expect(screen.getByText("确认")).toBeInTheDocument();
      expect(screen.getByText("取消")).toBeInTheDocument();
    });

    it("renders custom button labels", () => {
      renderDialog({ confirmLabel: "是的", cancelLabel: "不了" });
      expect(screen.getByText("是的")).toBeInTheDocument();
      expect(screen.getByText("不了")).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("disables confirmation when pending even without confirmDisabled", () => {
      renderDialog({ pending: true });
      expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
    });

    it("disables all closing controls and gestures while pending", () => {
      const onCancel = vi.fn();
      renderDialog({ confirmDisabled: true, pending: true, onCancel });
      const confirm = screen.getByRole("button", { name: "确认" });
      const cancel = screen.getByRole("button", { name: "取消" });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveAttribute("aria-busy", "true");
      expect(cancel).toBeDisabled();
      expect(cancel).toHaveAttribute("aria-busy", "true");
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(screen.getByRole("presentation"));
      expect(onCancel).not.toHaveBeenCalled();
    });
    it("calls onConfirm when the confirm button is clicked", async () => {
      const onConfirm = vi.fn();
      renderDialog({ onConfirm });
      await userEvent.click(screen.getByText("确认"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the cancel button is clicked", async () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      await userEvent.click(screen.getByText("取消"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the Escape key is pressed", async () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      await userEvent.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the backdrop overlay is clicked", async () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      // The backdrop is the outer fixed div with role="presentation"
      const backdrop = screen.getByRole("presentation");
      await userEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel when the dialog body itself is clicked", async () => {
      const onCancel = vi.fn();
      renderDialog({ onCancel });
      const dialog = screen.getByRole("dialog");
      await userEvent.click(dialog);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("does not call onCancel for Escape when dialog is closed", async () => {
      const onCancel = vi.fn();
      const { rerender } = render(
        <ConfirmDialog
          isOpen={false}
          title="测试"
          message="..."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      await userEvent.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();

      rerender(
        <ConfirmDialog
          isOpen={true}
          title="测试"
          message="..."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      await userEvent.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("unmount on close (with fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("unmounts when isOpen changes from true to false", () => {
      const { rerender } = render(
        <ConfirmDialog
          isOpen={true}
          title="测试"
          message="..."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      rerender(
        <ConfirmDialog
          isOpen={false}
          title="测试"
          message="..."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const exitingDialog = screen.getByRole("dialog", { hidden: true });
      expect(exitingDialog).toHaveStyle({ opacity: "0" });
      expect(exitingDialog.style.transform).toContain("scale(0.97)");

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();

      // The timer is a fallback for environments that do not emit transitionend.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("unmounts after the exit transition ends", () => {
      const { rerender } = renderDialog();
      rerender(
        <ConfirmDialog
          isOpen={false}
          title="删除任务"
          message="确定要删除这个任务吗？此操作不可撤销。"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const dialog = screen.getByRole("dialog", { hidden: true });
      fireEvent.transitionEnd(dialog, { propertyName: "opacity" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("makes exiting content inert and restores focus immediately", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "打开弹窗";
      document.body.appendChild(trigger);
      trigger.focus();

      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      const props = {
        title: "删除任务",
        message: "确定要删除这个任务吗？此操作不可撤销。",
        onConfirm,
        onCancel,
      };
      const { rerender } = render(<ConfirmDialog isOpen {...props} />);
      const confirmButton = screen.getByText("确认");
      const cancelButton = screen.getByText("取消");
      const backdrop = screen.getByRole("presentation");

      fireEvent.click(cancelButton);
      expect(onCancel).toHaveBeenCalledTimes(1);
      rerender(<ConfirmDialog isOpen={false} {...props} />);

      expect(trigger).toHaveFocus();
      expect(backdrop).toHaveAttribute("aria-hidden", "true");
      expect(backdrop).toHaveAttribute("inert");
      expect(backdrop.className).toContain("pointer-events-none");
      expect(confirmButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();

      fireEvent.click(confirmButton);
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(backdrop);

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);

      rerender(<ConfirmDialog isOpen {...props} />);
      expect(confirmButton).toHaveFocus();
      expect(confirmButton).toBeEnabled();
      expect(cancelButton).toBeEnabled();
      trigger.remove();
    });

    it("animates in after a newly keyed dialog mounts", () => {
      renderDialog();

      expect(screen.getByRole("dialog")).toHaveStyle({ opacity: "0" });

      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(screen.getByRole("dialog")).toHaveStyle({ opacity: "1" });
    });

    it("restarts the enter animation when reopened", () => {
      const props = {
        title: "测试",
        message: "...",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      const { rerender } = render(<ConfirmDialog isOpen {...props} />);

      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(screen.getByRole("dialog")).toHaveStyle({ opacity: "1" });

      rerender(<ConfirmDialog isOpen={false} {...props} />);
      rerender(<ConfirmDialog isOpen {...props} />);

      expect(screen.getByRole("dialog")).toHaveStyle({ opacity: "0" });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(screen.getByRole("dialog")).toHaveStyle({ opacity: "1" });
    });
  });

  describe("variant styling", () => {
    it("applies danger variant (red) by default", () => {
      renderDialog();
      const confirmBtn = screen.getByText("确认");
      expect(confirmBtn.className).toMatch(/bg-\[#ef4444\]/);
    });

    it("applies warning variant (amber) when specified", () => {
      renderDialog({ variant: "warning" });
      const confirmBtn = screen.getByText("确认");
      expect(confirmBtn.className).toMatch(/bg-\[#f59e0b\]/);
    });

    it("applies info variant (primary purple) when specified", () => {
      renderDialog({ variant: "info" });
      const confirmBtn = screen.getByText("确认");
      expect(confirmBtn.className).toMatch(/bg-\[#7165ea\]/);
    });
  });

  describe("accessibility", () => {
    it("sets aria-modal to true on the dialog", () => {
      renderDialog();
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "aria-modal",
        "true",
      );
    });

    it("associates title via aria-labelledby", () => {
      renderDialog();
      const dialog = screen.getByRole("dialog");
      const titleId = dialog.getAttribute("aria-labelledby");
      expect(titleId).toBeTruthy();
      const title = document.getElementById(titleId!);
      expect(title).toBeInTheDocument();
      expect(title!.textContent).toBeTruthy();
    });

    it("focuses the confirm button on open", () => {
      renderDialog({ isOpen: true });
      expect(screen.getByText("确认")).toHaveFocus();
    });

    it("restores the body overflow value that existed before mounting", () => {
      document.body.style.overflow = "clip";
      const { unmount } = renderDialog();
      expect(document.body.style.overflow).toBe("hidden");

      unmount();
      expect(document.body.style.overflow).toBe("clip");
      document.body.style.overflow = "";
    });
  });
});
