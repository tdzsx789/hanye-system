let appFontsPromise = null;

export function ensureAppFontsLoaded() {
  if (!appFontsPromise) {
    appFontsPromise = Promise.all([
      import("@fontsource/noto-sans-sc/chinese-simplified-400.css"),
      import("@fontsource/noto-sans-sc/chinese-simplified-700.css"),
      import("@fontsource/noto-sans-tc/chinese-traditional-400.css"),
      import("@fontsource/noto-sans-tc/chinese-traditional-700.css")
    ]).then(() => undefined);
  }
  return appFontsPromise;
}
