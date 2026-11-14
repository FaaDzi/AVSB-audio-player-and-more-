/** The app's own Reduce motion switch (Settings → Appearance), as theme.ts writes it on <html>. Windows' setting isn't used. */
export const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'on'
