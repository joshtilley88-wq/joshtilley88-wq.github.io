/* auth.html: hands the Microsoft sign-in response back to the app (popup / silent iframe / redirect). */
'use strict';
msalRedirectBridge.broadcastResponseToMainFrame().catch(e => {
  const m = document.getElementById('m');
  m.textContent = 'Nothing to finish here. ';
  const a = document.createElement('a'); a.href = './#/settings?tab=data'; a.textContent = 'Back to Invoicing'; m.appendChild(a);
  console.warn(e);
});
