// MAIN world, document_start. The player's own timedtext request is already signed (that's the
// POT that blocks anyone fetching the track directly) — so we copy its URL instead of forging one.
// MAIN and ISOLATED don't share a JS heap, so the URL is handed over on a DOM attribute, the one
// thing both worlds can see. Cost of this trick: we can't act until the player has asked first.
(() => {
  const stash = (url) => {
    if (typeof url === "string" && url.includes("/api/timedtext")) {
      document.documentElement.dataset.imTimedtext = url;
    }
  };

  const fetch_ = window.fetch;
  window.fetch = function (input, ...rest) {
    try {
      stash(typeof input === "string" ? input : input?.url);
    } catch {} // never let the hook break a page request
    // A bare fetch(url) call has `this` undefined, and native fetch throws Illegal invocation
    // on that — so fall back to window rather than passing it through.
    return fetch_.apply(this ?? window, [input, ...rest]);
  };

  const open_ = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    stash(url);
    return open_.call(this, method, url, ...rest);
  };
})();
