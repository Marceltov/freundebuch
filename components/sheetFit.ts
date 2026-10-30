// Where the browser doesn't shrink the page for the keyboard (Safari on iOS), the chat sheet pins itself to the visible
// area: its bottom on the keyboard, its top a little below the area's top, so the header can't slide out of view.

/** The sheet's top and bottom (px, in the page's fixed layer) while the keyboard covers part of the screen; null without one. */
export function sheetFit(innerHeight: number, vv: { height: number; offsetTop: number }): { top: number; bottom: number } | null {
  const bottom = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
  if (bottom === 0) return null;
  return { top: Math.round(vv.offsetTop + vv.height * 0.08), bottom };
}
