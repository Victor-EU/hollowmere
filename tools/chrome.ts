// Headless Chrome with a real GPU, shared by the screenshot and validation tools.
// Set CHROME to the browser binary if it isn't in the usual macOS place.

import { chromium, type Browser } from 'playwright-core';

const DEFAULT_CHROME =
  process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome';

export function launchChrome(): Promise<Browser> {
  // Metal on macOS; SwiftShader elsewhere (slow, but CI machines rarely have a GPU).
  const angle = process.env.ANGLE ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
  return chromium.launch({
    executablePath: process.env.CHROME ?? DEFAULT_CHROME,
    args: [`--use-angle=${angle}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
}
