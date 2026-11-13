const defaults = { enabled: true, daily: true, events: true, drops: true };
const fields = Object.keys(defaults);
let settings = { ...defaults };
const error = document.getElementById('error');
async function refreshStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    document.getElementById('status').textContent = !state.loggedIn ? 'Sign in to Kick to start claiming.' : !state.settings.enabled ? 'Auto-claim is paused.' : 'Connected to Kick. Auto-claim is enabled.';
    document.getElementById('reward').textContent = state.daily.reward ? 'Last daily reward: ' + state.daily.reward : state.daily.claimed ? 'Daily reward already claimed.' : 'Waiting for an eligible reward.';
    const checks = [state.daily.nextCheck, state.events.nextCheck, state.drops.nextCheck].filter(Boolean).map(Date.parse).filter(Number.isFinite);
    document.getElementById('next').textContent = checks.length ? 'Next check: ' + new Date(Math.min(...checks)).toLocaleTimeString('en-US') : '';
  } catch {
    document.getElementById('status').textContent = 'Open a Kick tab and reload it after installing.';
    document.getElementById('reward').textContent = '';
    document.getElementById('next').textContent = '';
  }
}
async function init() {
  try {
    settings = { ...defaults, ...(await chrome.storage.local.get('settings')).settings };
    for (const key of fields) {
      const input = document.getElementById(key);
      input.checked = settings[key];
      input.addEventListener('change', async () => {
        const previous = settings[key];
        settings[key] = input.checked;
        fields.forEach(id => document.getElementById(id).disabled = true);
        try { await chrome.storage.local.set({ settings }); error.textContent = ''; }
        catch { settings[key] = previous; input.checked = previous; error.textContent = 'Could not save settings. Please try again.'; }
        finally { fields.forEach(id => document.getElementById(id).disabled = false); }
        await refreshStatus();
      });
    }
    await refreshStatus();
    setInterval(refreshStatus, 2000);
  } catch { error.textContent = 'Could not load settings. Reopen the popup to retry.'; }
}
void init();
