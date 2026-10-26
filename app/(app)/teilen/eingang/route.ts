// The Android share target's address. The service worker (public/sw.js) normally catches the POST; this answers only when it
// didn't (the app was just installed and the worker isn't running yet): back to /teilen, which asks to share again.
const back = () => new Response(null, { status: 303, headers: { Location: "/teilen?nochmal=1" } });

export { back as GET, back as POST };
