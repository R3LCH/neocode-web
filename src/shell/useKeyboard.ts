import { useEffect, useState } from "react";

export type KeyboardState = {
  /** Soft keyboard is on screen. */
  open: boolean;
  /** Height the keyboard covers *below the layout viewport's bottom edge*
   *  — the `bottom:` offset for fixed elements pinned above it. */
  inset: number;
};

// Soft-keyboard detection. Browsers behave one of two ways:
//  - resizes-visual (iOS Safari, Chrome 108+): the layout viewport keeps its
//    size and only window.visualViewport shrinks → inset > 0.
//  - resizes-content (Android WebViews with adjustResize, e.g. Telegram): the
//    layout viewport itself shrinks → innerHeight drops while inset stays 0,
//    and fixed `bottom: 0` already sits right above the keyboard.
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ open: false, inset: 0 });

  useEffect(() => {
    // Tallest innerHeight seen at the current width — the keyboard-less
    // height. Width changes mean rotation, which resets the baseline.
    const baseline = { w: window.innerWidth, h: window.innerHeight };
    const update = () => {
      if (window.innerWidth !== baseline.w) {
        baseline.w = window.innerWidth;
        baseline.h = window.innerHeight;
      } else {
        baseline.h = Math.max(baseline.h, window.innerHeight);
      }
      const vv = window.visualViewport;
      const inset = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      const open = inset > 50 || window.innerHeight < baseline.h - 150;
      setState((s) =>
        s.open === open && s.inset === inset ? s : { open, inset },
      );
    };
    const vv = window.visualViewport;
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}
