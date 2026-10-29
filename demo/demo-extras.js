/* Web demo only: wires up the intro panel. Runs after app.js. */
(function () {
  const SAMPLE_QUEUE = ['RT-35578', 'RT-84535', 'RT-94839', 'RT-54781', 'RT-99999'];
  const INTRO_KEY = 'stockcheck-demo-intro-closed';

  function runCode(code) {
    showView('check');
    $('#check-input').value = code;
    $('#check-form').requestSubmit();
  }

  document.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => runCode(b.dataset.try)));

  $('#demo-queue').addEventListener('click', async () => {
    showView('queue');
    await addCodes(SAMPLE_QUEUE);
  });

  $('#demo-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset the demo?',
      'This clears your checks, queue and turn-offs and puts back the original sample data.', 'Reset demo');
    if (!ok) return;
    window.demoReset();
    queueResults.clear();
    currentQueueId = null;
    pendingRelay = null;
    $('#check-result').innerHTML = '<div class="empty-state">Scan or type a product code to check stock.</div>';
    $('#queue-result').innerHTML = '<div class="empty-state">Add codes on the left, then press <b>Work next pending</b>.</div>';
    await loadQueue();
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
  if (window.demoFirstVisit()) runCode('RT-76823');
})();
