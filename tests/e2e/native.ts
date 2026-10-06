// Raw-CDP plumbing for the surfaces Playwright cannot hold: the popup a
// toolbar click opens and the side panel are `page` targets, but never
// become a Playwright `Page` and never pass through `context.route`.
// One browser-level session reaches them: it triggers the toolbar
// action, answers their brreg requests from the fixtures, and tunnels a
// per-target session for evaluating, clicking and screenshotting.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { MISS_HEADER, fixtureReply, type loadFixtures } from '../../scripts/preview/fixtures.mjs';

type Fixtures = Awaited<ReturnType<typeof loadFixtures>>;

const BRREG = 'https://data.brreg.no/';
const TARGET_TIMEOUT_MS = 15_000;

interface Reply {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}

/** One extension document (popup, side panel) behind a tunnelled session. */
export interface NativeTarget {
  url: string;
  /** Evaluates an expression in the document; a promise is awaited. */
  evaluate<T>(expression: string): Promise<T>;
  /** A real (trusted) left click at the element's centre: carries a user gesture. */
  click(selector: string): Promise<void>;
  /** Resolves once the rendered text held still for half a second (a Page's networkidle). */
  settle(): Promise<void>;
  screenshot(path: string): Promise<void>;
}

export interface NativeBrowser {
  /** brreg requests no fixture answered, from any target in the browser. */
  fixtureMisses: string[];
  /**
   * Uncaught exceptions and error-level console entries (a CSP
   * violation is one) from every attached target, prefixed with its page.
   */
  problems: string[];
  /** A toolbar click on `page`'s tab: grants activeTab and opens the popup. */
  triggerAction(extensionId: string, page: Page): Promise<void>;
  /** The first `page` target whose URL contains `urlPart`, attached. */
  target(urlPart: string): Promise<NativeTarget>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the browser-level session and starts answering every brreg
 * request in the browser from `fixtures`. Fetch is enabled on the
 * browser target, so a document is covered from its first request: no
 * per-target attach has to win a race against the popup's own startup.
 */
export async function openNative(context: BrowserContext, fixtures: Fixtures): Promise<NativeBrowser> {
  const browser = context.browser();
  if (!browser) throw new Error('native smoke: the persistent context exposes no Browser to open a CDP session on');
  const cdp = await browser.newBrowserCDPSession();
  const fixtureMisses: string[] = [];
  const problems: string[] = [];

  cdp.on('Fetch.requestPaused', (e) => {
    const url = new URL(e.request.url);
    const reply = fixtureReply(fixtures, url.pathname + url.search);
    if (reply.headers[MISS_HEADER]) fixtureMisses.push(e.request.url);
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: reply.status,
        responseHeaders: Object.entries(reply.headers).map(([name, value]) => ({ name, value })),
        body: Buffer.from(reply.body).toString('base64'),
      })
      // The requesting document may be gone (the popup closes itself).
      .catch(() => undefined);
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${BRREG}*` }] });

  const routes = new Map<string, (reply: Reply) => void>();
  const closers = new Map<string, () => void>();
  cdp.on('Target.receivedMessageFromTarget', (e) => routes.get(e.sessionId)?.(JSON.parse(e.message) as Reply));
  cdp.on('Target.detachedFromTarget', (e) => closers.get(e.sessionId)?.());

  async function attach(targetId: string, url: string): Promise<NativeTarget> {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
    const name = new URL(url).pathname;
    const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
    let nextId = 0;
    let closed = false;

    const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (closed) return reject(new Error(`${method}: the target ${url} is closed`));
        const id = ++nextId;
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        cdp
          .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
          .catch(reject);
      });

    routes.set(sessionId, (reply) => {
      if (reply.id !== undefined) {
        const call = pending.get(reply.id);
        pending.delete(reply.id);
        if (reply.error) call?.reject(new Error(reply.error.message));
        else call?.resolve(reply.result);
        return;
      }
      const problem = describeProblem(reply);
      if (problem) problems.push(`${name}: ${problem}`);
    });
    closers.set(sessionId, () => {
      closed = true;
      for (const call of pending.values()) call.reject(new Error(`the target ${url} closed`));
      pending.clear();
    });

    // Both replay what the document logged before the attach, so
    // nothing from its startup is missed.
    await send('Runtime.enable');
    await send('Log.enable');

    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(`evaluate failed in ${url}: ${r.exceptionDetails.text}`);
      return r.result.value;
    };

    return {
      url,
      evaluate,
      async click(selector) {
        const at = await evaluate<{ x: number; y: number } | null>(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);
        if (!at) throw new Error(`click: no element matches ${selector} in ${url}`);
        const mouse = (type: string) =>
          send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
        await mouse('mousePressed');
        // The release may never be acknowledged: the click can close
        // the document (the popup closes itself on «Åpne i sidepanel»).
        await Promise.race([mouse('mouseReleased').catch(() => undefined), sleep(1_000)]);
      },
      async settle() {
        let last = '';
        for (let still = 0; still < 5; ) {
          await sleep(100);
          const text = await evaluate<string>('document.body.innerText');
          still = text === last ? still + 1 : 0;
          last = text;
        }
      },
      async screenshot(path) {
        const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(data, 'base64'));
      },
    };
  }

  return {
    fixtureMisses,
    problems,
    async triggerAction(extensionId, page) {
      // The action needs the `tab` target, a different id from the
      // `page` target Playwright holds; the URL ties the two together.
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
      const tab = targetInfos.find((t) => t.url === page.url());
      if (!tab) throw new Error(`native smoke: no tab target for ${page.url()}`);
      try {
        await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
      } catch (err) {
        throw new Error(
          'native smoke: CDP Extensions.triggerAction is unavailable or refused in this Chromium, so the ' +
            'toolbar click cannot be simulated and the popup flow is not covered: ' +
            (err instanceof Error ? err.message : String(err)),
          { cause: err },
        );
      }
    },
    async target(urlPart) {
      const deadline = Date.now() + TARGET_TIMEOUT_MS;
      for (;;) {
        const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'page', exclude: false }] });
        const found = targetInfos.find((t) => t.url.includes(urlPart));
        if (found) return attach(found.targetId, found.url);
        if (Date.now() > deadline) {
          throw new Error(
            `native smoke: no page target containing "${urlPart}" after ${TARGET_TIMEOUT_MS} ms; open: ` +
              targetInfos.map((t) => t.url).join(', '),
          );
        }
        await sleep(100);
      }
    },
  };
}

// The same line invariants.ts draws for Playwright pages: a failed brreg
// fetch is the API's contract (regnskap answers 500 for a bank) and is
// asserted through data-state; anything else at error level is a
// problem. Chromium logs a CSP violation as a `security` error entry.
function describeProblem(event: Reply): string | undefined {
  const p = event.params ?? {};
  if (event.method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails as { text: string; exception?: { description?: string } };
    return `uncaught: ${d.exception?.description ?? d.text}`;
  }
  if (event.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    const args = p.args as Array<{ value?: unknown; description?: string }>;
    return `console.error: ${args.map((a) => a.description ?? String(a.value)).join(' ')}`;
  }
  if (event.method === 'Log.entryAdded') {
    const entry = p.entry as { level: string; source: string; text: string; url?: string };
    if (entry.level !== 'error') return undefined;
    if (entry.source === 'network' && entry.url?.startsWith(BRREG)) return undefined;
    return `${entry.source}: ${entry.text}`;
  }
  return undefined;
}
