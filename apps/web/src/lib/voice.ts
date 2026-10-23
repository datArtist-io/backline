// Shared, mutable signal between the voice input and the 3D scene.
// Written by the mic analyser every frame; read by the scene in its render loop.
// Kept outside React state on purpose: updating it 60x a second must not re-render the page.
export const voice = {
  level: 0, // 0..1, smoothed microphone loudness
  listening: false,
};

export const pointer = {
  x: 0, // -1..1
  y: 0, // -1..1
};

