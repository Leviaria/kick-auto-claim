# Privacy — Kick Auto-Claim by Leviaria

Last updated: November 13, 2026

The extension runs on Kick.com to claim eligible daily rewards, event rewards and drops.
It reads the existing session_token cookie in memory and uses it, along with the browser's existing session cookies, to authenticate requests directly to https://web.kick.com. It reads reward eligibility, progress and claim results returned by Kick.

The extension does not send data to Leviaria or to analytics, advertising or other third-party servers. It does not sell data or include telemetry.

Preferences are saved locally using chrome.storage.local. Reward records, timestamps, retry state, temporary tab locks and a one-way session-token hash are stored in Kick.com's localStorage. The hash distinguishes sessions; it is still a persistent session-related identifier. Session tokens are not saved by the extension or included in popup messages or logs.

Removing the extension removes its extension settings. Reward state stored in Kick site data can remain: remove the keys psKickDailyReward, psKickDailyRewardLock, psKickDrops, psKickDropsLock, psKickEventRewards and psKickEventRewardsLock using browser developer tools, or clear Kick site data (which also signs you out). Event records are pruned during later claim updates; other state remains until overwritten or deleted.

Kick processes the authenticated API requests under its own privacy policy. This independent extension is not affiliated with or endorsed by Kick.
