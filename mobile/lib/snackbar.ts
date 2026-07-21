// Snackbar store — imperative, callable from anywhere (screens, mutation
// callbacks, non-component code), mirroring the module-singleton pattern used
// by analytics.track() and dialog.notify(). A single <SnackbarHost/> mounted
// in the root layout subscribes and renders the visible item.
//
// One snackbar is shown at a time; additional shows queue and advance as each
// dismisses. Actions (Retry / Undo) keep the snackbar up longer so there's
// time to tap.
//
// Note on modals: the host lives at the React root, so on native it does NOT
// render above an open RN <Modal>. Fire success/result snackbars AFTER a modal
// closes (on the parent screen); keep in-modal feedback inline.

export type SnackbarVariant = "success" | "error" | "info";

export type SnackbarAction = {
  label: string;
  onPress: () => void;
};

export type SnackbarOptions = {
  message: string;
  variant?: SnackbarVariant;
  /** Optional trailing action (Retry / Undo). Its presence extends the
   *  default duration so the user has time to reach it. */
  action?: SnackbarAction;
  /** Auto-dismiss in ms. 0 = sticky (until dismissed or acted on). Defaults
   *  by variant; longer when an action is present. */
  duration?: number;
};

export type SnackbarItem = Required<Omit<SnackbarOptions, "action">> & {
  id: number;
  action?: SnackbarAction;
};

type Listener = (item: SnackbarItem | null) => void;

// Default auto-dismiss windows (ms). Errors linger longer than successes;
// anything with an action gets extra time to tap.
const DURATION = { success: 3000, info: 3000, error: 5000, action: 6000 };

let counter = 0;
let current: SnackbarItem | null = null;
const queue: SnackbarItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

function advance() {
  current = queue.shift() ?? null;
  emit();
}

function normalize(opts: SnackbarOptions): SnackbarItem {
  const variant = opts.variant ?? "info";
  const duration =
    opts.duration ??
    (opts.action ? DURATION.action : DURATION[variant]);
  return {
    id: ++counter,
    message: opts.message,
    variant,
    duration,
    action: opts.action,
  };
}

export const snackbar = {
  /** Queue a snackbar. Returns its id (for imperative dismiss). */
  show(opts: SnackbarOptions): number {
    const item = normalize(opts);
    if (current) {
      queue.push(item);
    } else {
      current = item;
      emit();
    }
    return item.id;
  },

  // Reference `snackbar` directly rather than `this` so a detached call
  // (`const { success } = snackbar`) can't break with an undefined `this`.
  success(message: string, opts?: Omit<SnackbarOptions, "message" | "variant">) {
    return snackbar.show({ ...opts, message, variant: "success" });
  },

  error(message: string, opts?: Omit<SnackbarOptions, "message" | "variant">) {
    return snackbar.show({ ...opts, message, variant: "error" });
  },

  info(message: string, opts?: Omit<SnackbarOptions, "message" | "variant">) {
    return snackbar.show({ ...opts, message, variant: "info" });
  },

  /** Dismiss the visible snackbar (no id), or remove a specific one whether
   *  it's showing or still queued. */
  dismiss(id?: number) {
    if (id == null || current?.id === id) {
      advance();
      return;
    }
    const i = queue.findIndex((q) => q.id === id);
    if (i >= 0) queue.splice(i, 1);
  },

  /** Host subscription. Immediately invokes with the current item. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(current);
    return () => listeners.delete(listener);
  },
};

// A native <Modal> takes roughly this long to animate out. The snackbar host
// lives at the React root, so on native it can't render above an open modal.
export const MODAL_ANIM_MS = 300;

/** Run a snackbar call after a just-closed native <Modal> has finished
 *  dismissing, so it isn't emitted behind the still-animating modal and
 *  missed. Use in a mutation onSuccess that also hides a modal. */
export function snackbarAfterModalClose(run: () => void): void {
  setTimeout(run, MODAL_ANIM_MS);
}
