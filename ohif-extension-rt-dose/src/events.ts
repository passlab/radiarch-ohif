// A dose finished loading: the viewport stops its loading indicator, the DVH panel draws. Kept inside the extension
// rather than on an OHIF service's private broadcast.

type Listener = (displaySet) => void;

const listeners = new Set<Listener>();

export function emitDoseLoaded(displaySet) {
  listeners.forEach(l => l(displaySet));
}

export function onDoseLoaded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
