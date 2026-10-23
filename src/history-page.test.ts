// The History page under media/ is plain browser code that no bundler touches, so it is read here
// as the webview loads it.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync('media/history.js', 'utf8');

// A field of a modal: the page only wires it, focuses it and reads its value.
function field() {
  return { value: '', addEventListener: () => undefined, focus: () => undefined, classList: { toggle: () => true, add: () => undefined } };
}

// The page run against the few DOM calls it makes to draw the day list and open a modal: it is
// enough to read the markup it writes and to click a day, without a DOM library.
function loadPage(state?: unknown) {
  let saved = state;
  let onMessage = (_event: { data: unknown }): void => undefined;
  const clicks = new Map<string, () => void>();
  const app = {
    innerHTML: '',
    // The page looks rows up only to wire their click, so the fakes are read off the markup.
    querySelectorAll: () =>
      [...app.innerHTML.matchAll(/<li class="([^"]*)" data-date="(\d+)">/g)].map(([, classes, date]) => {
        const names = new Set(classes.split(' '));
        return {
          getAttribute: () => date,
          classList: { toggle: (name: string) => (names.delete(name) ? false : (names.add(name), true)) },
          addEventListener: (_type: string, listener: () => void) => clicks.set(date, listener),
        };
      }),
  };
  // The modal the page appended to the body, whose fields are looked up by the ids of its markup.
  const modals: { innerHTML: string; addEventListener: () => void }[] = [];
  const fields = new Map<string, ReturnType<typeof field>>();
  const byId = (id: string) => {
    if (id === 'app') return app;
    if (!modals.some((m) => m.innerHTML.includes(`id="${id}"`))) return null;
    if (!fields.has(id)) fields.set(id, field());
    return fields.get(id);
  };
  runInNewContext(PAGE, {
    acquireVsCodeApi: () => ({
      postMessage: () => undefined,
      getState: () => saved,
      setState: (next: unknown) => (saved = next),
    }),
    document: {
      getElementById: byId,
      createElement: () => ({ innerHTML: '', addEventListener: () => undefined }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      body: { style: {}, appendChild: (modal: (typeof modals)[number]) => modals.push(modal) },
    },
    window: { addEventListener: (type: string, listener: typeof onMessage) => type === 'message' && (onMessage = listener) },
  });
  return {
    show: (...dates: string[]) => onMessage({ data: { type: 'history', payload: { strings: {}, days: dates.map(day) } } }),
    receive: (message: unknown) => onMessage({ data: message }),
    markup: () => app.innerHTML,
    modals: () => modals.map((m) => m.innerHTML),
    click: (date: string) => clicks.get(date)?.(),
    expanded: () => [...app.innerHTML.matchAll(/<li class="[^"]*\btt-expanded\b[^"]*" data-date="(\d+)">/g)].map((m) => m[1]),
    state: () => saved,
  };
}

// A day with two sessions, which the list shows on one line until it is clicked.
function day(date: string) {
  return { date, label: date, hoursLabel: '2h 00m', commitsLabel: '0 commits', sessionsLabel: 'Session 1 · Session 2' };
}

describe('history.js', () => {
  it('keeps a day expanded when the refresh redraws the list', () => {
    const page = loadPage();
    page.show('20261021', '20261020');
    page.click('20261020');
    page.show('20261021', '20261020');
    expect(page.expanded()).toEqual(['20261020']);
  });

  it('keeps a day collapsed once clicked again', () => {
    const page = loadPage();
    page.show('20261021', '20261020');
    page.click('20261020');
    page.click('20261020');
    page.show('20261021', '20261020');
    expect(page.expanded()).toEqual([]);
  });

  it('expands the same days on a page reloaded after the view was hidden', () => {
    const before = loadPage();
    before.show('20261021', '20261020');
    before.click('20261021');
    const after = loadPage(before.state());
    after.show('20261021', '20261020');
    expect(after.expanded()).toEqual(['20261021']);
  });

  it('saves only the expanded days the list still shows', () => {
    const page = loadPage();
    page.show('20261020', '20261006');
    page.click('20261006');
    page.show('20261021', '20261020');
    page.click('20261020');
    expect(page.state()).toEqual({ expanded: ['20261020'] });
  });

  it.each([undefined, 42, { expanded: '20261020' }, { expanded: [20261020] }])('draws from a saved state %j', (state) => {
    const page = loadPage(state);
    page.show('20261020');
    expect(page.expanded()).toEqual([]);
  });

  it.each([
    ['history', { strings: {}, days: [day('20261021')] }],
    ['months', { totalLabel: '2h 00m', months: [{ label: 'October 2026', hoursLabel: '2h 00m' }] }],
  ])('draws the %s page without an icon font', (type, payload) => {
    // The font weighed more than half of the package.
    const page = loadPage();
    page.receive({ type, payload });
    expect(page.markup()).not.toContain('codicon');
  });

  it('opens the add-time form when the host asks for it', () => {
    // The view's title bar action runs a command, which asks the page for its form.
    const page = loadPage();
    page.show('20261021');
    page.receive({ type: 'openAddForm' });
    expect(page.modals()).toEqual([expect.stringContaining('<form class="tt-modal" id="tt-form">')]);
  });
});

describe('history.css', () => {
  it('scales the panel from the editor font size, which a fontSize of 0 leaves in place', () => {
    // The page drops its inline size for 0, and the description of the setting promises the editor
    // size then. --vscode-font-size is the workbench size, a fixed 13px.
    const body = /^body\s*\{([^}]*)\}/m.exec(readFileSync('media/history.css', 'utf8'))?.[1] ?? '';
    expect(body).toMatch(/font-size:\s*var\(--vscode-editor-font-size\b/);
  });
});
