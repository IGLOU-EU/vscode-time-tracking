// The global the webview runtime gives the page, callable once per load
// (https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-a-webview-to-an-extension).
// Its messages are typed by the core protocol, so the type check holds the page to what the host accepts.
declare function acquireVsCodeApi(): {
  postMessage(message: import('../src/core/page-message').FromPage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
