/* Web demo only: wires up the intro panel. Runs after app.js. */
(function () {
  const INTRO_KEY = 'stockcheck-demo-intro-closed';

  document.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => checkCode(b.dataset.try)));

  $('#demo-routes').addEventListener('click', () => showView('routes'));

  $('#demo-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset the demo?',
      'This clears your checks and turn-offs and puts back the original sample data.', 'Reset demo');
    if (!ok) return;
    window.demoReset();
    pendingRelay = null;
    currentRouteId = null;
    $('#check-result').innerHTML = '<div class="empty-state">Scan or type a product code to check stock.</div>';
    refreshSidebar();
    showView(currentView);
    toast('Demo reset');
  });

  // Remember whether the visitor collapsed the intro.
  const details = $('#demo-intro-details');
  try { if (localStorage.getItem(INTRO_KEY) === '1') details.open = false; } catch (_) { /* ignore */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(INTRO_KEY, details.open ? '0' : '1'); } catch (_) { /* ignore */ }
  });

  // First visit: open on a real result so the page shows what it does.
  if (window.demoFirstVisit()) checkCode('RT-76823');
})();
