/* Knockout Arena — boot */
(function () {
  'use strict';
  const BX = window.BX;

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function boot() {
    const loading = document.getElementById('loading');
    if (!window.THREE || !hasWebGL()) {
      loading.classList.add('done');
      document.getElementById('nogl').classList.remove('hidden');
      return;
    }
    try {
      BX.Profile.load();
      BX.Input.init();
      BX.Game.init(document.getElementById('game'));
      BX.UI.init();
      BX.UI.show('menu');
      BX.UI.updateTouchVisibility();
      setTimeout(() => loading.classList.add('done'), 250);
    } catch (e) {
      console.error(e);
      loading.querySelector('.ld-sub').textContent = 'Something went wrong: ' + e.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
