/**
 * The application — seven steps, saved as you go.
 *
 * Step 1 is the criteria disclosure (A2): the bar is stated, by side, before a
 * single field about the applicant is collected. Step 4 is photographs and
 * liveness (A3); step 6 is the interest declaration (B0), which is part of what
 * a reviewer reads.
 */

import { api } from '../api.js';
import { escapeHtml, words } from '../format.js';
import { toast, toastError } from '../toast.js';
import { refreshSession, go } from '../router.js';
import { confirmSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

const PROMPTS = [
  'A perfect Sunday',
  'The last thing that genuinely impressed me',
  "Something I've changed my mind about",
  'Where I go when I need to think',
  "What I'm still trying to get good at"
];

const TOTAL = 7;

// `step` stays null until the first render so a resumed application opens where
// the applicant left off — the saved step is on the application record, and a
// default of 1 here would silently send everyone back to the beginning.
const state = { step: null, data: null, interests: null };

export async function renderApply(root) {
  const payload = await api.application.mine();
  state.data = payload;
  if (state.step == null) {
    state.step = Math.min(TOTAL, Math.max(1, payload.application?.step || 1));
  }
  if (state.interests === null) {
    state.interests = [...(payload.profile?.interestCategories || [])];
  }
  paint(root);
}

/** Seven bars, filled up to and including the current step. */
function steps(step) {
  return `<div class="steps">${Array.from({ length: TOTAL }, (_, i) => `
    <span class="${i < step ? 'on' : ''}"></span>`).join('')}</div>
    <div class="eyebrow">Step ${step} of ${TOTAL}</div>`;
}

function paint(root) {
  const { profile, photos, liveness, requirements, preferences } = state.data;
  const step = state.step;

  const screens = {
    1: () => criteria(requirements),
    2: () => aboutYou(profile),
    3: () => yourLife(profile, requirements),
    4: () => photoStep(photos, requirements),
    5: () => whoYouMeet(preferences),
    6: () => openTo(requirements),
    7: () => verifyStep(liveness, photos, requirements)
  };

  root.innerHTML = screens[step]();
  decorate(root);
  wire(root);
}

/* ---------- 1 · criteria (A2, F1.2) ---------- */

function criteria(req) {
  // Row three is the standing criterion for men; women are told the photo
  // standard in its place. Both sides are told exactly which bar applies.
  const third = req.needsMeans
    ? {
      title: 'Standing <span class="tag tag-outline" style="margin-left:6px">Men only</span>',
      body: `A ${req.interviewMinutes || 20}-minute call. <span class="accent">No bank statements, ever.</span>`
    }
    : {
      title: 'Photo standards',
      body: 'Your own photographs, recent, and clear enough to be matched. <span class="accent">Nothing is scored by a model.</span>'
    };

  const rows = [
    ['Identity', 'A liveness selfie, matched to your photos. Held 90 days, then deleted.'],
    ['Photos', `${req.minPhotos} to ${req.maxPhotos}. One face, unobscured. Location data stripped on upload.`],
    [third.title, third.body],
    ['A complete profile', 'Read by a reviewer against a written rubric. Never scored by a model.']
  ];

  return `
    <section class="screen">
      <div class="backrow">
        <span class="eyebrow" style="margin:0">Before you begin</span>
      </div>
      <div class="pad" style="padding-top:26px">
        <h1>What we assess</h1>
        <p class="lede" style="margin:8px 0 24px">These four, in this order. Nothing hidden, nothing else.</p>
        <div class="grid-list">
          ${rows.map(([title, body], i) => `
            <div class="grid-row" style="align-items:flex-start">
              <span style="font-size:11px;line-height:1.4;color:var(--accent)">0${i + 1}</span>
              <div class="grid-row__body">
                <div class="grid-row__title" style="font-size:16px">${title}</div>
                <div class="grid-row__note" style="font-size:12.5px;color:var(--t55);margin-top:3px">${body}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="screen__foot">
        <div class="notice" style="margin-bottom:16px">
          A human reviews this. Decision inside ${req.slaHours} hours, with a reason.
        </div>
        <button class="btn btn--primary btn--block" data-next type="button">Begin application</button>
      </div>
    </section>`;
}

/* ---------- 2 · about you ---------- */

function aboutYou(profile) {
  const p = profile || {};
  return stepShell(2, `
    <h1 class="h-lg">About you</h1>
    <p class="lede" style="margin:8px 0 22px">Only your first name is ever shown. Members see an age, never a date.</p>
    <form id="step-form">
      ${text('firstName', 'First name', p.firstName, { autocomplete: 'given-name', required: true })}
      ${text('dateOfBirth', 'Date of birth', (p.dateOfBirth || '').slice(0, 10), { type: 'date', required: true })}
      ${text('city', 'City', p.city, { autocomplete: 'address-level2', required: true })}
      ${text('occupation', 'What you do', p.occupation, { placeholder: 'Founder, logistics group', required: true })}
      ${text('employer', 'Where', p.employer, { placeholder: 'Company or practice' })}
      ${text('height', 'Height in centimetres', p.height, { type: 'number', min: 120, max: 230 })}
      ${navRow('Continue')}
    </form>`);
}

/* ---------- 3 · your life ---------- */

function yourLife(profile, req) {
  const p = profile || {};
  const means = state.data.application?.means || {};
  const prompt = p.prompts?.[0] || { q: PROMPTS[0], a: '' };

  return stepShell(3, `
    <h1 class="h-lg">Your life</h1>
    <p class="lede" style="margin:8px 0 22px">This is what a reviewer, and then a member, actually reads.</p>
    <form id="step-form">
      ${select('intent', 'What you are looking for', ['long_term', 'life_partner', 'still_deciding'], p.intent)}
      ${select('education', 'Education', ['secondary', 'undergraduate', 'postgraduate', 'doctorate'], p.education)}
      ${select('drinking', 'Drinking', ['never', 'socially', 'regularly'], p.drinking)}
      ${select('smoking', 'Smoking', ['never', 'socially', 'regularly'], p.smoking)}
      ${select('children', 'Children', ['none', 'have_children', 'want_children', 'prefer_not_to_say'], p.children)}
      ${req.needsMeans ? select('incomeBand', 'Household income', ['1m_2m', '2m_5m', '5m_10m', '10m_plus'], means.incomeBand) : ''}

      <div class="field">
        <label for="f-bio">In your words</label>
        <textarea id="f-bio" name="bio" maxlength="300" placeholder="Three lines that sound like you, not like a CV.">${escapeHtml(p.bio || '')}</textarea>
        <p class="hint"><span id="bio-count">${(p.bio || '').length}</span> / 300</p>
      </div>

      <div class="field">
        <label for="f-prompt-q">A question to answer</label>
        <select id="f-prompt-q" name="promptQ" style="margin-bottom:9px">
          ${PROMPTS.map((q) => `<option ${prompt.q === q ? 'selected' : ''}>${escapeHtml(q)}</option>`).join('')}
        </select>
        <textarea id="f-prompt-a" name="promptA" maxlength="250" placeholder="Your answer">${escapeHtml(prompt.a || '')}</textarea>
      </div>
      ${navRow('Continue')}
    </form>`);
}

/* ---------- 4 · photographs and liveness (A3, F1.4/F1.5) ---------- */

function photoStep(photos, req) {
  const slots = Array.from({ length: req.maxPhotos }, (_, i) => photos[i] || null);
  const enough = photos.length >= req.minPhotos;

  return `
    <section class="screen">
      <div class="backrow">
        <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back">←</button>
        <span class="backrow__right">Saved</span>
      </div>
      <div class="pad" style="padding-top:20px">
        ${steps(4)}
        <h1 class="h-lg">Photographs</h1>
        <p class="lede" style="margin:6px 0 20px">${req.minPhotos} minimum. One must show your face, unobscured.</p>

        <div class="photogrid">
          ${slots.map((photo, i) => photo ? `
            <div class="photoslot${i === 0 ? ' photoslot--face' : ''}">
              <div class="duotone" style="width:100%;height:100%">
                <img src="/api/photos/${photo.id}/thumb" alt="Photograph ${i + 1}" loading="lazy" />
              </div>
              <button class="photoslot__x" data-remove="${photo.id}" type="button" aria-label="Remove photograph ${i + 1}">×</button>
              <span class="photoslot__tag${photo.moderationState === 'pending' ? ' photoslot__tag--pending' : ''}">
                ${i === 0 ? '1 · Face' : photo.moderationState === 'pending' ? 'In review' : 'Live'}
              </span>
            </div>` : `
            <button class="photoslot photoslot--empty" data-add type="button" aria-label="Add a photograph">+</button>`).join('')}
        </div>

        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t40);margin-top:10px">
          <span>${photos.length} of ${req.maxPhotos} uploaded</span>
          <span>JPEG · PNG · HEIC · 12 MB</span>
        </div>

        <div class="blueprint" style="margin-top:26px;padding:16px;display:flex;gap:14px;align-items:center">
          <div class="ph" data-ph="Selfie" style="width:62px;height:62px;flex:none"></div>
          <div>
            <h3>Liveness check</h3>
            <p class="meta" style="margin-top:3px;font-size:12px;color:var(--t55)">
              A prompted pose. Matched to the photographs above, then deleted at 90 days.
            </p>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:18px;font-size:11.5px;color:var(--t45)">
          <span style="color:var(--accent)">✓</span> Location data is removed from every upload.
        </div>
      </div>
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/heic,image/webp" hidden />
      <div class="screen__foot">
        <div class="btn-row">
          <button class="btn btn--secondary" style="height:52px;flex:1" data-back type="button">Save &amp; exit</button>
          <button class="btn btn--primary" style="height:52px;flex:2;font-size:15px" data-next type="button" ${enough ? '' : 'disabled'}>Continue</button>
        </div>
        ${enough ? '' : `<p class="hint center" style="margin-top:10px">Add ${req.minPhotos - photos.length} more to continue.</p>`}
      </div>
    </section>`;
}

/* ---------- 5 · who you'd like to meet ---------- */

function whoYouMeet(preferences) {
  const p = preferences || {};
  return stepShell(5, `
    <h1 class="h-lg">Who you'd like to meet</h1>
    <p class="lede" style="margin:8px 0 22px">
      Both sides' ranges have to agree before an introduction is drawn, so this narrows
      your deck and theirs equally. You can change it later.
    </p>
    <form id="step-form">
      <div class="field">
        <label for="f-ageMin">Age range</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input id="f-ageMin" name="ageMin" type="number" min="18" max="99" value="${escapeHtml(p.ageMin ?? 25)}" style="width:90px" />
          <span class="dim">to</span>
          <input name="ageMax" type="number" min="18" max="99" value="${escapeHtml(p.ageMax ?? 45)}" style="width:90px" />
        </div>
      </div>
      <div class="field">
        <label for="f-distanceKm">Within</label>
        <select id="f-distanceKm" name="distanceKm">
          ${[10, 25, 50, 100, 250].map((km) => `<option value="${km}" ${Number(p.distanceKm) === km ? 'selected' : ''}>${km} km</option>`).join('')}
        </select>
        <p class="hint">Another member only ever sees a band — under 5 km, 5–15, 15–50, 50 km+ — never a distance.</p>
      </div>
      ${navRow('Continue')}
    </form>`);
}

/* ---------- 6 · what are you open to (B0) ---------- */

function openTo(req) {
  const groups = req.interestGroups || [];
  const chosen = state.interests || [];

  return `
    <section class="screen">
      <div class="backrow">
        <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back">←</button>
        <span class="backrow__right">Saved</span>
      </div>
      <div class="pad" style="padding-top:16px">
        ${steps(6)}
        <h1 class="h-lg">What are you open to?</h1>
        <p class="lede" style="margin:6px 0 14px">Choose any. Only members whose interests overlap yours will see you.</p>
      </div>
      <div class="pad" style="flex:1">
        <div class="grid-list grid-list--bare" style="border-top:1px solid var(--grid)">
          ${groups.map((group) => `
            <div style="padding:10px 0 4px">
              <span class="eyebrow eyebrow--accent" style="margin:0">${escapeHtml(group.label)}</span>
            </div>
            ${group.options.map((option) => `
              <label class="check" style="padding:7px 0">
                <input type="checkbox" data-interest="${escapeHtml(option.key)}" ${chosen.includes(option.key) ? 'checked' : ''} />
                <span class="check__box" aria-hidden="true">✓</span>
                <span>${escapeHtml(option.label)}</span>
              </label>`).join('')}`).join('')}
        </div>
      </div>
      <div class="screen__bar">
        <p class="legal" style="margin-bottom:12px" id="interest-note">${interestNote(chosen.length)}</p>
        <button class="btn btn--primary btn--block" style="height:50px" data-next type="button" ${chosen.length ? '' : 'disabled'}>Continue</button>
      </div>
    </section>`;
}

/**
 * The live count, and the disclosure that has to sit beside it. Exclusivity is not
 * a party to anything a member arranges and no money moves between members —
 * that line is required, not decoration, and there is no rate or fee field
 * anywhere on this screen by design.
 */
function interestNote(count) {
  const spelled = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][count] || String(count);
  return `${escapeHtml(spelled)} selected. Exclusivity takes no part in any arrangement and no money moves between members.`;
}

/* ---------- 7 · verify ---------- */

function verifyStep(liveness, photos, req) {
  const ready = liveness && photos.length >= req.minPhotos;
  return stepShell(7, `
    <h1 class="h-lg">Verify it's you</h1>
    <p class="lede" style="margin:8px 0 22px">
      One photograph now, looking straight at the camera. A reviewer compares it to your
      photographs. It is never shown to another member, and it is deleted at 90 days.
    </p>

    ${liveness ? `
      <div class="notice">
        <strong>Capture received</strong>
        Taken ${escapeHtml(new Date(liveness.capturedAt).toLocaleString('en-ZA'))}. You can retake it.
      </div>` : ''}

    <button class="btn ${liveness ? 'btn--secondary' : 'btn--primary'} btn--full" data-liveness type="button">
      ${liveness ? 'Retake the capture' : 'Take the capture'}
    </button>
    <input type="file" id="liveness-input" accept="image/*" capture="user" hidden />

    <hr class="rule" />

    <div class="eyebrow">Before you send it</div>
    <div class="grid-list">
      ${checkRow(`${photos.length} photograph${photos.length === 1 ? '' : 's'} uploaded`, photos.length >= req.minPhotos)}
      ${checkRow('Verification capture', Boolean(liveness))}
      ${checkRow(state.interests?.length ? `${state.interests.length} interest${state.interests.length === 1 ? '' : 's'} declared` : 'Interests declared', Boolean(state.interests?.length))}
      ${checkRow(req.interviewExpected ? 'A short call will be arranged by email' : 'A reviewer will read your application', true)}
    </div>
    `, { footer: `
      <div class="btn-row">
        <button class="btn btn--secondary" style="height:52px;flex:1" data-back type="button">Back</button>
        <button class="btn btn--primary" style="height:52px;flex:2;font-size:15px" data-submit type="button" ${ready ? '' : 'disabled'}>Send it in</button>
      </div>` });
}

function checkRow(label, done) {
  return `<div class="grid-row${done ? '' : ' grid-row--off'}">
    <div class="grid-row__body"><div class="grid-row__title" style="font-size:13.5px;font-family:var(--body);font-weight:400">${escapeHtml(label)}</div></div>
    <span class="tick${done ? '' : ' tick--off'}">${done ? '✓' : '—'}</span>
  </div>`;
}

/* ---------- shared shell and fields ---------- */

function stepShell(step, body, { footer = null } = {}) {
  return `
    <section class="screen">
      <div class="backrow">
        <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back">←</button>
        <span class="backrow__right">Saved</span>
      </div>
      <div class="pad" style="padding-top:20px;padding-bottom:26px">
        ${steps(step)}
        ${body}
      </div>
      ${footer ? `<div class="screen__foot">${footer}</div>` : ''}
    </section>`;
}

function navRow(label) {
  return `<div class="btn-row" style="margin-top:8px">
    <button class="btn btn--secondary" type="button" data-back>Back</button>
    <button class="btn btn--primary" type="submit">${escapeHtml(label)}</button>
  </div>`;
}

function text(name, label, value, { type = 'text', ...attrs } = {}) {
  const extra = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeHtml(v)}"`))
    .join(' ');
  return `<div class="field">
    <label for="f-${name}">${escapeHtml(label)}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra} />
  </div>`;
}

function select(name, label, options, value) {
  return `<div class="field">
    <label for="f-${name}">${escapeHtml(label)}</label>
    <select id="f-${name}" name="${name}">
      <option value="">—</option>
      ${options.map((o) => `<option value="${o}" ${value === o ? 'selected' : ''}>${escapeHtml(words(o))}</option>`).join('')}
    </select>
  </div>`;
}

/* ---------- saving ---------- */

function collect(root) {
  const form = root.querySelector('#step-form');
  if (!form) return {};
  const fd = new FormData(form);
  const out = {};
  for (const [key, value] of fd.entries()) {
    if (value !== '' && value != null) out[key] = value;
  }
  if (out.height) out.height = Number(out.height);
  if (out.promptQ || out.promptA) {
    out.prompts = [{ q: out.promptQ, a: out.promptA || '' }];
    delete out.promptQ;
    delete out.promptA;
  }
  return out;
}

async function save(root, step) {
  const fields = collect(root);

  // Step 5 writes preferences, not the profile; everything else is profile.
  if (state.step === 5) {
    await api.profile.savePreferences({
      ageMin: Number(fields.ageMin),
      ageMax: Number(fields.ageMax),
      distanceKm: Number(fields.distanceKm)
    });
    await api.application.save({ step });
    state.data = await api.application.mine();
    return;
  }

  const { incomeBand, ...profile } = fields;

  // A rough centroid for the city keeps distance banding possible without
  // ever storing a precise location.
  if (profile.city && !state.data.profile?.coords) {
    profile.coords = { lat: -26.2041 + (Math.random() - 0.5) * 0.15, lon: 28.0473 + (Math.random() - 0.5) * 0.15 };
  }

  await api.application.save({
    step,
    profile,
    ...(incomeBand ? { means: { incomeBand, employer: profile.employer } } : {})
  });
  state.data = await api.application.mine();
}

async function saveInterests(step) {
  await api.application.save({ step, profile: { interestCategories: state.interests } });
  state.data = await api.application.mine();
}

function wire(root) {
  const bio = root.querySelector('#f-bio');
  bio?.addEventListener('input', () => {
    root.querySelector('#bio-count').textContent = String(bio.value.length);
  });

  root.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.step = Math.max(1, state.step - 1);
      paint(root);
    });
  });

  root.querySelector('[data-next]')?.addEventListener('click', async () => {
    const next = Math.min(TOTAL, state.step + 1);
    try {
      if (state.step === 6) await saveInterests(next);
      // Steps with nothing to collect still record where the applicant got to,
      // so closing the tab here and coming back lands on the same screen.
      else await api.application.save({ step: next });
    } catch (err) { return toastError(err); }
    state.step = next;
    paint(root);
    return undefined;
  });

  root.querySelector('#step-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const next = Math.min(TOTAL, state.step + 1);
    try {
      await save(root, next);
      state.step = next;
      paint(root);
    } catch (err) {
      toastError(err);
      btn.disabled = false;
    }
  });

  // Interest checkboxes are local until Continue, per the design — but the
  // count and the disclosure under them update on every toggle.
  root.querySelectorAll('[data-interest]').forEach((box) => {
    box.addEventListener('change', () => {
      const key = box.dataset.interest;
      state.interests = box.checked
        ? [...new Set([...state.interests, key])]
        : state.interests.filter((k) => k !== key);
      const note = root.querySelector('#interest-note');
      if (note) note.innerHTML = interestNote(state.interests.length);
      const next = root.querySelector('[data-next]');
      if (next) next.disabled = state.interests.length === 0;
    });
  });

  // photographs
  const fileInput = root.querySelector('#photo-input');
  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => fileInput.click());
  });
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    toast('Uploading…');
    try {
      await api.photos.upload(file);
      state.data = await api.application.mine();
      paint(root);
      toast('Photograph added');
    } catch (err) {
      toastError(err);
    }
    fileInput.value = '';
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.photos.remove(btn.dataset.remove);
        state.data = await api.application.mine();
        paint(root);
      } catch (err) { toastError(err); }
    });
  });

  // liveness
  const liveInput = root.querySelector('#liveness-input');
  root.querySelector('[data-liveness]')?.addEventListener('click', () => liveInput.click());
  liveInput?.addEventListener('change', async () => {
    const file = liveInput.files?.[0];
    if (!file) return;
    toast('Uploading…');
    try {
      await api.application.liveness(file);
      state.data = await api.application.mine();
      paint(root);
      toast('Capture received');
    } catch (err) { toastError(err); }
    liveInput.value = '';
  });

  root.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Send your application?',
      body: "A reviewer reads it and replies inside 48 hours. You cannot edit it while it is with them.",
      confirmLabel: 'Send it in'
    });
    if (!ok) return;
    try {
      await api.application.submit();
      await refreshSession();
      state.step = null;
      state.interests = null;
      go('status');
    } catch (err) { toastError(err); }
  });
}
