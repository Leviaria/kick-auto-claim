# Testing

Automated checks use mocked Kick responses. They cover eligible claims, unearned drops, token handling, pause behavior, signed-out sessions, feature switches and an unavailable multi-tab lock. They do not prove that the live API accepts requests from Chrome.

Before a public release:

- Load the unpacked extension in Chrome and check the popup for layout or console errors.
- Claim an eligible daily reward, event reward and drop on a signed-in account.
- Confirm in Kick that each claim was accepted.
- Open two Kick tabs and check that a reward is not submitted twice.
- Pause auto-claim and test each feature switch separately.
- Sign out, sign in and switch accounts. Confirm state belongs to the current session.
- Restart Chrome and verify saved settings.
- Check that failed requests back off and that a rate-limit response is respected.

Do not include cookies, authorization headers or session tokens in screenshots, logs or issue reports.
