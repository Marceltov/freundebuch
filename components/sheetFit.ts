// Where the browser doesn't shrink the page for the keyboard (Safari on iOS), the chat sheet pins itself to the visible
// area: its bottom on the keyboard, its top a little below the area's top, so the header can't slide out of view. Safari
// often pans the visible area all the way down to the field, leaving nothing below it: the keyboard is told by the visible
// area being shorter than the page, not by a gap under it.

/** The sheet's top and bottom (px, in the page's fixed layer) while the keyboard covers part of the screen; null without one. */
export function sheetFit(innerHeight: number, vv: { height: number; offsetTop: number }): { top: number; bottom: number } | null {
  if (innerHeight - vv.height < 1 && vv.offsetTop < 1) return null;
  const bottom = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
  return { top: Math.round(vv.offsetTop + vv.height * 0.08), bottom };
}
