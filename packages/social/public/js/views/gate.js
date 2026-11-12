/**
 * A1 — the door.
 *
 * The screen positions on curation and verification and never on provision: a
 * hero plate, the claim, and the three things that are true before anyone
 * spends ten minutes on an application.
 */

import { api } from '../api.js';
import { toast, toastError } from '../toast.js';
import { refreshSession, renderRoute } from '../router.js';

function signInForm() {
  return `
    <form id="signin" novalidate>
      <div class="field">
        <label for="si-email">Email</label>
        <input id="si-email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="si-password">Password</label>
        <input id="si-password" type="password" autocomplete="current-password" required />
      </div>
      <button class="btn btn--primary btn--block" type="submit">Sign in</button>
    </form>
    <p class="meta center" style="margin-top:18px">
      Not a member yet? <button class="link" data-mode="apply" type="button">Apply</button>
    </p>`;
}

function applyForm() {
  return `
    <form id="signup" novalidate>
      <div class="field">
        <label>Applying as</label>
        <div class="tags" id="side-choices">
          <button type="button" class="chip" data-side="female" aria-pressed="false">A woman</button>
          <button type="button" class="chip" data-side="male" aria-pressed="false">A man</button>
        </div>
        <p class="hint" id="side-hint">Both sides are read by a person. Men also sit a short call.</p>
      </div>
      <div class="field">
        <label for="su-name">Full name</label>
        <input id="su-name" type="text" autocomplete="name" required />
      </div>
      <div class="field">
        <label for="su-city">City</label>
        <input id="su-city" type="text" autocomplete="address-level2" placeholder="Johannesburg" required />
        <p class="hint">Open in Johannesburg only. Elsewhere, you go on the waitlist.</p>
      </div>
      <div class="field">
        <label for="su-email">Email</label>
        <input id="su-email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="su-password">Password</label>
        <input id="su-password" type="password" autocomplete="new-password" required />
        <p class="hint">Eight characters or more, with upper and lower case, a number and a symbol.</p>
      </div>
      <button class="btn btn--primary btn--block" type="submit">Start my application</button>
      <p class="legal" style="margin-top:16px">
        You must be 18 or older. Every application is read by a person, and you will be
        asked to verify your photographs.
      </p>
    </form>
    <p class="meta center" style="margin-top:18px">
      Already a member? <button class="link" data-mode="signin" type="button">Sign in</button>
    </p>`;
}

export async function renderGate(root) {
  let mode = 'intro';

  function paint() {
    if (mode === 'intro') {
      root.innerHTML = `
        <section class="screen">
          <div class="ph" data-ph="Hero" style="height:min(352px,38vh);margin:26px 22px 0"></div>
          <div class="pad" style="padding-top:30px;flex:1;display:flex;flex-direction:column">
            <div class="eyebrow" style="color:var(--accent);letter-spacing:.34em;font-family:var(--head);font-weight:600;font-size:11px">Exclusivity</div>
            <h1 class="h-hero" style="margin-top:16px">Membership,<br>by review.</h1>
            <p style="font-size:14px;color:rgba(231,235,239,.58);margin:14px 0 0;max-width:30ch">
              Both sides apply. A person decides. Johannesburg.
            </p>
            <div class="screen__foot" style="padding-inline:0;gap:12px;display:flex;flex-direction:column">
              <div style="display:flex;gap:18px;font-size:11px;color:var(--t40)">
                <span>48h decision</span><span>·</span><span>Identity verified</span><span>·</span><span>No public profiles</span>
              </div>
              <button class="btn btn--primary" style="height:52px;font-size:15px;letter-spacing:.04em" data-mode="apply" type="button">Apply for membership</button>
              <button class="btn btn--secondary" style="height:48px" data-mode="signin" type="button">Sign in</button>
            </div>
          </div>
        </section>`;
      return;
    }

    root.innerHTML = `
      <section class="screen">
        <div class="backrow">
          <button class="glyphbtn glyphbtn--quiet" data-mode="intro" type="button" aria-label="Back">←</button>
          <span class="eyebrow" style="margin:0">${mode === 'signin' ? 'Welcome back' : 'Create your account'}</span>
        </div>
        <div class="pad" style="padding-top:22px;padding-bottom:30px">
          <h1>${mode === 'signin' ? 'Sign in' : 'Apply'}</h1>
          <p class="lede" style="margin:8px 0 24px">
            ${mode === 'signin'
    ? 'Pick up where you left off.'
    : 'Credentials first. What we assess comes next, before you fill in anything about yourself.'}
          </p>
          ${mode === 'signin' ? signInForm() : applyForm()}
        </div>
      </section>`;

    if (mode === 'apply') wireApply();
    else wireSignIn();
  }

  function wireSignIn() {
    root.querySelector('#signin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.auth.login({
          email: root.querySelector('#si-email').value.trim(),
          password: root.querySelector('#si-password').value
        });
        await refreshSession();
        location.hash = '#/';
        await renderRoute(null);
        location.reload();
      } catch (err) {
        toastError(err);
        btn.disabled = false;
      }
    });
  }

  function wireApply() {
    let side = null;
    const hint = root.querySelector('#side-hint');

    root.querySelectorAll('#side-choices .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        side = btn.dataset.side;
        root.querySelectorAll('#side-choices .chip').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        hint.textContent = side === 'male'
          ? 'Every man sits a twenty-minute call before he joins. No financial paperwork, ever.'
          : 'Your photographs are matched to a live capture. Membership is free, permanently.';
      });
    });

    root.querySelector('#signup').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!side) return toast('Choose which side you are applying to', { bad: true });

      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.auth.register({
          side,
          fullName: root.querySelector('#su-name').value.trim(),
          city: root.querySelector('#su-city').value.trim(),
          email: root.querySelector('#su-email').value.trim(),
          password: root.querySelector('#su-password').value
        });
        await refreshSession();
        location.hash = '#/apply';
        location.reload();
      } catch (err) {
        toastError(err);
        btn.disabled = false;
      }
      return undefined;
    });
  }

  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-mode]');
    if (trigger) {
      mode = trigger.dataset.mode;
      paint();
    }
  });

  paint();
}
