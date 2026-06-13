# Samsung TV Prototype

This repo can build a first-pass Samsung TV app as a packaged Tizen Web app. The TV app is static, and it talks back to the Home Media server running on your PC over the LAN.

## What Was Added

- `public/config.xml` is copied into `dist/` so Tizen tooling can package the Vite build as a `.wgt`.
- `public/tizen-icon.png` provides a bitmap launcher icon for the Tizen package.
- `npm run build:tv` builds with relative asset paths for the packaged TV runtime.
- `npm run preview:lan` serves the built app and `/api/*` media endpoints on the local network.
- The frontend can use a configured server URL through `VITE_HOME_MEDIA_API_BASE`, `?api=...`, or the in-app settings button.
- The media API allows LAN/CORS requests and exposes range headers for video playback.
- The app handles basic Samsung remote-style navigation with arrow keys, back, and media play/pause.

## Current Official Tooling

For a new setup, prefer Samsung's VS Code based tooling:

- Tizen SDK / tools: https://samsungtizenos.com/tools-download/
- Samsung TV VS Code extension docs: https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode-extension.html
- Samsung TV CLI docs: https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html

Tizen Studio still appears in Samsung TV docs, but Samsung's current Tizen SDK 10 direction is VS Code plus CLI tooling.

## 1. Start The LAN Server

Find the IPv4 address of the PC that will run Home Media:

```powershell
ipconfig
```

Use the address for your active Wi-Fi or Ethernet adapter. The examples below use `192.168.1.25`.

Build the TV app with that server URL baked in:

```powershell
cd F:\projects\home-media
$env:VITE_HOME_MEDIA_API_BASE = 'http://192.168.1.25:4173'
npm run build:tv
```

Start the built app and API on the LAN:

```powershell
$env:HOME_MEDIA_ROOT = 'F:\media'
npm run preview:lan
```

From a phone or another computer on the same network, verify:

```text
http://192.168.1.25:4173/api/library
```

If that URL does not load, the TV will not load the library either. Check Windows Firewall, the selected adapter IP, and whether the Vite preview server is still running.

## 2. Install Samsung TV Tooling

1. Install Visual Studio Code.
2. Install the VS Code extension named `Tizen TV`. The publisher should be `samsungtvsdk`.
3. In the Tizen extension package manager, install the latest TV extension.
4. Install the Tizen CLI if the extension prompts for it.
5. Create a Samsung certificate profile. Keep the author certificate safe because future updates must be signed with the same author certificate.

## 3. Enable Developer Mode On The TV

1. Put the TV and PC on the same network.
2. On the Samsung TV, open `Apps`.
3. Open `App Settings`.
4. Enter `12345` with the remote or on-screen keypad.
5. Turn `Developer mode` on.
6. Enter the PC IP address, for example `192.168.1.25`.
7. Reboot the TV.

After rebooting, the Apps screen should show a developer-mode indicator.

## 4. Package And Install

Recommended VS Code flow:

1. Run `npm run build:tv`.
2. Open `F:\projects\home-media\dist` in VS Code.
3. Use the command palette and run `Tizen TV: Build Signed Package`.
4. Connect to the TV from the Tizen TV extension.
5. Install or launch the generated `.wgt` on the connected TV target.

CLI fallback:

```powershell
cd F:\projects\home-media
tizen package -t wgt -s <certificate-profile-name> -- F:\projects\home-media\dist
sdb connect <tv-ip>:26101
sdb devices
tizen install -s <device-serial> --name <generated-package>.wgt -- F:\projects\home-media\dist
tizen run -s <device-serial> -p HMedia0001.HomeMedia
```

The package/application ID used by this prototype is:

```text
HMedia0001.HomeMedia
```

## 5. Configure The Server URL On TV

The preferred path is to bake the URL in before `npm run build:tv`:

```powershell
$env:VITE_HOME_MEDIA_API_BASE = 'http://192.168.1.25:4173'
npm run build:tv
```

If the TV app opens but points at the wrong server, select the settings icon in the app, enter the server URL, and save:

```text
http://192.168.1.25:4173
```

The app stores that value in TV local storage.

## 6. First Smoke Test On The TV

1. Launch the app.
2. Confirm the library count loads.
3. Use arrow keys to move focus through the sidebar, cards, and player controls.
4. Select a playable MP4/M4V/MOV/WebM item.
5. Press play and confirm video starts.
6. Stop and relaunch the app, then confirm resume history still appears.

## Notes For A Real Store Submission

- `config.xml` currently allows `access origin="*"` for local prototyping. For store submission, narrow this to production server domains.
- This prototype uses browser video playback. Samsung TV playback support varies by model and codec; a production app will probably need Samsung AVPlay for the best media compatibility.
- Hosted/cloud-only apps have extra Samsung policy restrictions. Keep the app code packaged and use the server for API/media data.
- Seller Office submission still requires app images, screenshots, age rating, UI description, service-country configuration, and certification.
