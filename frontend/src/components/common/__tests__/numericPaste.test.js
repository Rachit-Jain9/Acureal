import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNumericPaste } from '../numericPaste';
import { toast } from '../Toast';

vi.mock('../Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const evt = (text) => ({
  clipboardData: { getData: () => text },
  preventDefault: vi.fn(),
});

describe('handleNumericPaste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes a grouped figure and writes the clean value', () => {
    const setValue = vi.fn();
    const e = evt('₹5,35,67,890');
    handleNumericPaste(e, 'rupeePlain', setValue);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith('53567890');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('leaves a clean ungrouped number to paste natively (no intercept)', () => {
    const setValue = vi.fn();
    const e = evt('53567890');
    handleNumericPaste(e, 'rupeePlain', setValue);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
  });

  it('interprets a full-rupee paste into a ₹ Cr field as crore + toasts transparently', () => {
    const setValue = vi.fn();
    handleNumericPaste(evt('₹5,35,67,890'), 'rupeeCrore', setValue);
    expect(setValue).toHaveBeenCalledWith('5.356789');
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('₹5.36 Cr'));
  });

  it('raises a clear toast and does not write on unreadable paste', () => {
    const setValue = vi.fn();
    handleNumericPaste(evt('twelve thousand'), 'rupeePlain', setValue);
    expect(setValue).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('does nothing for a non-money field (kind none)', () => {
    const setValue = vi.fn();
    const e = evt('₹5,35,67,890');
    handleNumericPaste(e, 'none', setValue);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
  });
});
