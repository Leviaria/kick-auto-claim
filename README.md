# Kick Auto-Claim

<img width="591" height="295" alt="image" src="https://github.com/user-attachments/assets/5eef6b4b-620a-4299-bc78-f14d5b2b9e62" />

A Chrome/Brave extension that claims eligible daily rewards, event rewards and drops on Kick.

Keep a signed-in Kick tab open. The extension checks your progress and submits a claim when a reward is ready. Daily rewards, events and drops can each be switched off in the popup.

[Download version 1.0.1](https://github.com/Leviaria/kick-auto-claim/releases/download/1.0.1/kick-auto-claim-1.0.1.zip)

## Installation

1. Download the extension ZIP attached to a release and extract it to a folder you want to keep.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Disable any older auto-claim userscript, then reload your Kick tabs.

You can also download the repository using **Code > Download ZIP**. Extract it and load the folder containing `manifest.json` in the same way. No build step is required.

Keep the extracted folder in place. Chrome loads the extension from that folder.

## Usage

Open the extension from Chrome's toolbar. Auto-claim starts enabled. Use the main switch to pause it, or turn off individual reward types.

The popup shows the connection status of your current tab, the last known daily reward and the next scheduled check. Open it from a Kick tab to see that information. Settings apply to all Kick tabs.

The extension only claims rewards you have earned. It does not generate watch time, skip requirements or keep working after all Kick tabs are closed. A claim already sent to Kick may finish after you switch auto-claim off.

## Updates

Download and extract the new release, replace the files in your existing extension folder, then click **Reload** on the extension card at `chrome://extensions`. Reload your Kick tabs afterwards.

GitHub downloads do not install updates automatically.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| The popup asks you to open Kick | Switch to a Kick tab and reload it after installing or updating. |
| Rewards are not being claimed | Check that you are signed in, the relevant switch is on and the reward is eligible. Failed requests can pause checks for 30 minutes or longer. |
| Checks are delayed | Chrome can slow down background tabs or suspend them. Return to the Kick tab to resume checks. |
| Kick still shows a reward notification | The extension does not modify Kick's internal UI cache. Reload the page to refresh it. |

## Privacy

No analytics, ads or developer server. Requests go directly to Kick using your existing session. Settings are stored locally. Reward state, retry times and a session hash are stored in Kick's site data.

The extension reads the session token to authenticate requests, but does not save the token or expose it in the popup. See [Privacy](PRIVACY.md) for storage and removal details.

## Development

Plain JavaScript, HTML and CSS. No runtime dependencies.

Run the local checks with Node.js 20 or newer:

```sh
node --check content.js
node --check popup.js
node tests/content.test.cjs
```

Build a release ZIP with Python 3:

```sh
python3 scripts/package.py
```

The ZIP is written to `dist/`. See [Testing](docs/TESTING.md) for the manual checks to run before a release.

## Status

The local mocked tests pass. Authenticated reward claims have not yet been tested live. Kick's private API can change without notice.

Independent project, not affiliated with or endorsed by Kick.

## License

[MIT](LICENSE). Copyright Leviaria.
