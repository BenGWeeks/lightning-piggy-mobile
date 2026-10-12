/** Tracks replacement as well as dismissal, so scope cleanup cannot hide a newer toast. */
export function createToastOwnership<T extends { onHide?: () => void }>(adapter: {
  show: (options: T) => void;
  hide: () => void;
}) {
  let current: object | undefined;
  const show = (options: T) => {
    const owner = {};
    current = owner;
    adapter.show({
      ...options,
      onHide: () => {
        if (current === owner) current = undefined;
        options.onHide?.();
      },
    });
    return owner;
  };
  const hide = () => {
    current = undefined;
    adapter.hide();
  };
  return {
    show: (options: T) => {
      show(options);
    },
    hide,
    showOwned: (options: T) => {
      const owner = show(options);
      return () => {
        if (current === owner) hide();
      };
    },
  };
}
