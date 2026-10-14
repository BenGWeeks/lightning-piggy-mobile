import { act, renderHook } from '@testing-library/react-native';
import type { Event as NostrEvent } from 'nostr-tools';
import { useProductCommentActions } from './useProductCommentActions';

const mockEditComment = jest.fn();
const mockPublishComment = jest.fn();
const mockDeleteComment = jest.fn();
const mockToastShow = jest.fn();

jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({
  Toast: { show: (...args: unknown[]) => mockToastShow(...args) },
}));
jest.mock('./usePublishProductFeedback', () => ({
  usePublishProductFeedback: () => ({
    publishComment: mockPublishComment,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    publishing: false,
    canPublish: true,
  }),
}));

const comment = (id: string, content: string): NostrEvent => ({
  id,
  pubkey: 'p'.repeat(64),
  created_at: 1,
  kind: 1111,
  tags: [],
  content,
  sig: 's'.repeat(128),
});

const a = comment('a'.repeat(64), 'Do you delever to the UK?');
const b = comment('b'.repeat(64), 'Second');
const root = comment('r'.repeat(64), 'product');

function setup() {
  const addLocally = jest.fn();
  const hideLocally = jest.fn(() => jest.fn());
  const hook = renderHook(() =>
    useProductCommentActions({
      root,
      pubkey: 'p'.repeat(64),
      addLocally,
      hideLocally,
      refetch: jest.fn(),
    }),
  );
  return { ...hook, addLocally, hideLocally };
}

beforeEach(() => jest.clearAllMocks());

describe('useProductCommentActions — edit in place (#1524)', () => {
  it('edits in the card, leaving the top composer untouched', () => {
    const { result } = setup();
    act(() => result.current.setContent('a new comment draft'));
    act(() => result.current.startEdit(a));
    expect(result.current.editDraft).toEqual({ comment: a, text: a.content });
    expect(result.current.content).toBe('a new comment draft');
    act(() => result.current.setEditText('Do you deliver to the UK?'));
    expect(result.current.editDraft?.text).toBe('Do you deliver to the UK?');
    expect(result.current.content).toBe('a new comment draft');
  });

  it('opening Edit on another comment cancels the first', () => {
    const { result } = setup();
    act(() => result.current.startEdit(a));
    act(() => result.current.setEditText('changed'));
    act(() => result.current.startEdit(b));
    expect(result.current.editDraft).toEqual({ comment: b, text: 'Second' });
  });

  it('Cancel restores the card', () => {
    const { result } = setup();
    act(() => result.current.startEdit(a));
    act(() => result.current.cancelEdit());
    expect(result.current.editDraft).toBeNull();
  });

  it('Save publishes the edit, swaps in the replacement, and closes the editor', async () => {
    const replacement = comment('c'.repeat(64), 'Do you deliver to the UK?');
    mockEditComment.mockResolvedValue({ replacement, oldDeleted: true });
    const { result, addLocally, hideLocally } = setup();
    act(() => result.current.startEdit(a));
    await act(async () => {
      await result.current.saveEdit(a, 'Do you deliver to the UK?');
    });
    expect(mockEditComment).toHaveBeenCalledWith(a, 'Do you deliver to the UK?');
    expect(addLocally).toHaveBeenCalledWith(replacement);
    expect(hideLocally).toHaveBeenCalledWith(a.id);
    expect(result.current.editDraft).toBeNull();
    expect(result.current.savingEditIds.size).toBe(0);
  });

  it('keeps the editor open when the edit fails to publish', async () => {
    mockEditComment.mockRejectedValue(new Error('no relay'));
    const { result } = setup();
    act(() => result.current.startEdit(a));
    act(() => result.current.setEditText('changed'));
    await act(async () => {
      await result.current.saveEdit(a, 'changed');
    });
    expect(result.current.editDraft).toEqual({ comment: a, text: 'changed' });
    expect(result.current.savingEditIds.size).toBe(0);
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text1: 'market.comments.editFailed' }),
    );
  });

  it('does not publish an unchanged or empty edit', async () => {
    const { result } = setup();
    act(() => result.current.startEdit(a));
    await act(async () => {
      await result.current.saveEdit(a, `  ${a.content} `);
      await result.current.saveEdit(a, '   ');
    });
    expect(mockEditComment).not.toHaveBeenCalled();
    expect(result.current.editDraft).not.toBeNull();
  });

  it.each(['A first', 'B first'])(
    'blocks duplicate saves across overlapping edits (%s)',
    async (order) => {
      let resolveA!: (value: unknown) => void;
      let resolveB!: (value: unknown) => void;
      mockEditComment
        .mockReturnValueOnce(new Promise((resolve) => (resolveA = resolve)))
        .mockReturnValueOnce(new Promise((resolve) => (resolveB = resolve)));
      const { result, addLocally } = setup();
      const replacementA = comment('c'.repeat(64), 'changed A');
      const replacementB = comment('d'.repeat(64), 'changed B');
      let pendingA!: Promise<void>;
      let pendingB!: Promise<void>;
      act(() => result.current.startEdit(a));
      act(() => {
        pendingA = result.current.saveEdit(a, 'changed A');
        // A second tap before React renders must also be rejected.
        void result.current.saveEdit(a, 'duplicate A');
      });
      act(() => result.current.startEdit(b));
      act(() => {
        pendingB = result.current.saveEdit(b, 'changed B');
      });
      act(() => result.current.startEdit(a));
      expect(result.current.savingEditIds).toEqual(new Set([a.id, b.id]));
      await act(async () => {
        await result.current.saveEdit(a, 'another duplicate A');
      });
      expect(mockEditComment).toHaveBeenCalledTimes(2);

      const aFirst = order === 'A first';
      await act(async () => {
        if (aFirst) resolveA({ replacement: replacementA, oldDeleted: true });
        else resolveB({ replacement: replacementB, oldDeleted: true });
        await (aFirst ? pendingA : pendingB);
      });
      const stillPending = aFirst ? b : a;
      act(() => result.current.startEdit(stillPending));
      expect(result.current.savingEditIds).toEqual(new Set([stillPending.id]));
      await act(async () => {
        await result.current.saveEdit(stillPending, 'duplicate after other save finished');
      });
      expect(mockEditComment).toHaveBeenCalledTimes(2);
      await act(async () => {
        if (aFirst) resolveB({ replacement: replacementB, oldDeleted: true });
        else resolveA({ replacement: replacementA, oldDeleted: true });
        await (aFirst ? pendingB : pendingA);
      });
      expect(result.current.savingEditIds.size).toBe(0);
      expect(addLocally).toHaveBeenCalledTimes(2);
      expect(addLocally).toHaveBeenCalledWith(replacementA);
      expect(addLocally).toHaveBeenCalledWith(replacementB);
    },
  );

  it('allows retrying the same comment after a failed save', async () => {
    const replacement = comment('c'.repeat(64), 'changed');
    mockEditComment
      .mockRejectedValueOnce(new Error('no relay'))
      .mockResolvedValueOnce({ replacement, oldDeleted: true });
    const { result, addLocally } = setup();
    act(() => result.current.startEdit(a));
    await act(async () => {
      await result.current.saveEdit(a, 'changed');
    });
    await act(async () => {
      await result.current.saveEdit(a, 'changed');
    });
    expect(mockEditComment).toHaveBeenCalledTimes(2);
    expect(addLocally).toHaveBeenCalledWith(replacement);
    expect(result.current.savingEditIds.size).toBe(0);
  });

  it('a save finishing after the user moved on leaves the newer edit open', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockEditComment.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    act(() => result.current.startEdit(a));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.saveEdit(a, 'changed');
    });
    expect(result.current.savingEditIds.has(a.id)).toBe(true);
    act(() => result.current.startEdit(b));
    await act(async () => {
      resolve({ replacement: comment('d'.repeat(64), 'changed'), oldDeleted: true });
      await pending;
    });
    expect(result.current.editDraft).toEqual({ comment: b, text: 'Second' });
  });
});
