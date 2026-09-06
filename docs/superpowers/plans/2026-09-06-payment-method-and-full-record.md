# Payment Method and Full Order Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which app a buyer paid with, and make every Orders row a complete record: cut, line and order totals, line position, payment method, confirmation code.

**Architecture:** `preorder.html` gains a required Zelle/Venmo chip pair in panel 03 and sends `fit`, `payMethod`, `paymentCode` on every per-line POST, keeping the old fields for a stale script. `google-apps-script.gs` gets a 13-column header row, a `rowFor(d)` mapper that accepts old and new payloads, and `ensureHeaders(sh)` that repairs a header-only sheet. Tests: a Node harness that runs the real `.gs` against stubbed Google services, and a Playwright suite against a local static server.

**Tech Stack:** static HTML/CSS/ES5 page, Google Apps Script, Node 22 + Playwright 1.62 (already installed under a scratchpad; junction it, do not reinstall).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-06-payment-method-and-full-record-design.md`.
- Header row, verbatim: `Timestamp, Name, Email, Cut, Size, Qty, Line Total ($), Order Total ($), Line, Payment, Confirmation Code, Paid?, Source`.
- Payment method values are exactly `"Zelle"` and `"Venmo"`. Required; no default.
- Blocked-submit copy: `Pick how you're paying.`
- Code-field labels: `Zelle confirmation code (optional)`, `Venmo transaction ID (optional)`, neutral `Payment confirmation code (optional)`.
- Old payload fields `item` and `zelleCode` keep being sent.
- `ensureHeaders` never throws and never blocks an append.
- Page JS stays ES5 (no arrow functions, no let/const) to match the file.
- Scratchpad for this session: `C:\Users\Shadman Kaiser\AppData\Local\Temp\claude\c--Users-Shadman-Kaiser-Desktop-Claude-Code-Projects-SRC-Website\90563713-4de7-4d9a-a3e8-edc77893e87b\scratchpad` (has a `node_modules` junction to Playwright). Prior test scripts live in the `e17f0327-692b-40fc-8105-5519b9e0ec90` scratchpad next to it.

---

### Task 1: Apps Script — new columns, payload mapping, header repair

**Files:**
- Modify: `google-apps-script.gs` (whole file rewritten; keep the deploy warning comment and the `doGet` health check)
- Modify: `PREORDER-SETUP.md` (sheet columns paragraph, multi-singlet section, payments section, curl sample)
- Test: `<scratchpad>/gs-test.mjs`

**Interfaces:**
- Consumes: POST body JSON with optional `fit`, `payMethod`, `paymentCode` (Task 2 adds them) plus the existing `timestamp, name, email, size, quantity, total, zelleCode, company, item, source, orderTotal, lineIndex, lineCount`.
- Produces: `HEADERS` (13 strings), `PAID_COL` (number), `rowFor(d)`, `cutOf(d)`, `ensureHeaders(sh)`, `countOrderRows(sh)`, `writeHeaders(sh)`. `doGet` unchanged.

- [x] **Step 1: Write the failing harness** — `<scratchpad>/gs-test.mjs` (full source in the scratchpad; it stubs `SpreadsheetApp`, `LockService`, `MailApp`, `ContentService` and a fixed `Date`, loads the real `.gs` with `vm`, and asserts):
  1. New-shape post on an empty sheet writes the 13-header row, then `[ts, 'Ana Ruiz', 'ana@x.com', "Men's", 'S', 1, 50, 150, '1 of 2', 'Venmo', '4H2K9', false, source]`, inserts a checkbox at row 2 column 12, freezes row 1, and emails once with the method and `$150 across 2 lines`.
  2. Second line (`lineIndex: 1`) appends with `Line = '2 of 2'`, its own cut, the shared order total, and sends no email.
  3. Old-shape post (no `fit`/`payMethod`/`paymentCode`/`orderTotal`/`lineIndex`) maps cut from `item`'s parenthesis, order total from `total`, `Line = '1 of 1'`, empty Payment, code from `zelleCode`, and emails.
  4. A sheet holding only the OLD header row gets row 1 rewritten and the order on row 2.
  5. A sheet with old headers AND an order row keeps row 1 and still appends.
  6. Honeypot returns ok and writes nothing.
  7. `setupSheet` refuses with order rows and rewrites a header-only sheet.
  8. `doGet` reports `closesAt` and `open`.

- [x] **Step 2: Run it, expect failures on the row shape**

Run (from the scratchpad): `node gs-test.mjs`
Expected: FAIL on header row, new-shape row, checkbox column, second line, old-shape row, stale header repair. PASS on honeypot and doGet.

- [x] **Step 3: Rewrite `google-apps-script.gs`** with: the 13-entry `HEADERS`; `PAID_COL = HEADERS.indexOf('Paid?') + 1`; `countOrderRows(sh)` (non-empty column A below row 1); `writeHeaders(sh)` (values, bold, dark background, gold text, frozen row); `ensureHeaders(sh)` (empty sheet: write; row 1 differs and no orders: clear row 1 across `max(HEADERS.length, getLastColumn())` and write; otherwise leave alone); `setupSheet` using those helpers with the existing refuse-if-data guard; `cutOf(d)` (`d.fit`, else the trailing parenthesised part of `d.item`, else `''`); `rowFor(d)` producing the 13 values in header order with `qty = d.quantity || 1`, `total = d.total ?? ''`, `orderTotal = d.orderTotal ?? total`, `Line = (lineIndex + 1) + ' of ' + (d.lineCount || 1)`, `Payment = d.payMethod || ''`, `code = d.paymentCode || d.zelleCode || ''`, `Paid? = false`; `doPost` calling `ensureHeaders`, `appendRow(rowFor(d))`, `insertCheckboxes` on `PAID_COL`, and the heads-up email listing line, order total, `Paying with:` and `Confirmation code:`. Keep the CLOSES_AT warning comment and `doGet` exactly as they are.

- [x] **Step 4: Run the harness, expect all PASS**

Run: `node gs-test.mjs`
Expected: every line `PASS`, exit code 0.

- [x] **Step 5: Update `PREORDER-SETUP.md`**

Replace the "Sheet columns:" paragraph under Route A with:

```markdown
Sheet columns: `Timestamp, Name, Email, Cut, Size, Qty, Line Total ($), Order
Total ($), Line, Payment, Confirmation Code, Paid?, Source`. One row per
singlet line; a two-singlet order is two rows sharing a timestamp, name, email,
order total and confirmation code, with `Line` reading `1 of 2` and `2 of 2`.
**Payment** is Zelle or Venmo, picked by the buyer. **Paid?** is a checkbox you
tick by hand once you match the transfer.

The script repairs the header row itself: an empty sheet, or one whose row 1 is
an older layout with no orders beneath it, gets the current headers on the next
post. A sheet that already holds orders is never rewritten.
```

In "## Multi-singlet orders", replace the sentence beginning "To match a Zelle payment, add up" through "summing `Quantity`." with:

```markdown
To match a payment, find the name and read **Order Total ($)**; every row of
that order carries it, and **Payment** says which app to look in. To tally
sizes for the manufacturer, pivot on `Cut` and `Size` summing `Qty`.
```

In "## Payments", replace "Match incoming payments to orders by name and amount in whichever app they used; the sheet does not record which one." with:

```markdown
The form asks which one they used, so the sheet's **Payment** column says where
to look; match by name and **Order Total ($)** there.
```

In the curl sample under "Whichever route you pick, test it", replace the JSON line with:

```
{"name":"TEST - delete me","email":"test@saintsrunclub.com","fit":"Men's","size":"M","quantity":1,"total":50,"orderTotal":50,"lineIndex":0,"lineCount":1,"payMethod":"Venmo","paymentCode":"TEST","item":"Race Day Singlet (Men's)","zelleCode":"TEST","source":"curl"}
```

- [x] **Step 6: Commit**

```bash
git add google-apps-script.gs PREORDER-SETUP.md
git commit -m "Record the payment method and the whole order on every sheet row"
```

---

### Task 2: Page — "Paying with" chips, dynamic code label, payload fields

**Files:**
- Modify: `preorder.html` CSS after the `.sizes .size` rule (~line 461); markup in panel 03 between the email field and the code field (~lines 944-947); `CONFIG` (~line 998); `state` (~line 1015); chip rendering after `renderChips(sizesEl, …)` (~line 1086); submit validation after the email check (~line 1295); payload map (~lines 1311-1325); reset handler (~line 1377)
- Modify: `<scratchpad>/check-cart.mjs`, `<scratchpad>/check-venmo.mjs` (copied from the prior scratchpad; add a payment pick before every submit that is meant to succeed)
- Test: `<scratchpad>/check-payment.mjs`

**Interfaces:**
- Consumes: `renderChips(host, values, assign)`, `clearChips(host)`, `setError(msg, field)`, `setText(el, text)`, `$()`, `state`, `CONFIG`, `codeEl`.
- Produces: `CONFIG.payMethods = ['Zelle', 'Venmo']`, `state.pay`, `#pays` chip host, `#code-label`, `codeLabelFor(pay)`, `syncCodeLabel()`, payload fields `fit`, `payMethod`, `paymentCode`.

- [x] **Step 1: Set up the scratchpad and write the failing suite** — copy `serve.mjs`, `check-cart.mjs`, `check-venmo.mjs`, `check-sizes.mjs`, `check-mobile.mjs`, `check-live.mjs` from the prior scratchpad; start `node serve.mjs "<repo>" 8123` in the background. `<scratchpad>/check-payment.mjs` (full source in the scratchpad) asserts, against `http://127.0.0.1:8123/preorder.html` with the Apps Script route stubbed to `{"ok":true}`:
  - render: `#pays` has two buttons reading `Zelle,Venmo`, none pressed; `#code-label` reads the neutral text; pressing Venmo then Zelle then Zelle again cycles the label Venmo → Zelle → neutral; no console errors.
  - gate: cut + size + name + email, no method, submit → `#note` reads `Pick how you're paying.` with `data-error="true"`, no POST, form visible, receipt hidden; picking a method clears the error; with code `V123` the single POST carries `payMethod 'Venmo'`, `fit "Men's"`, `paymentCode 'V123'` and the unchanged old fields (`zelleCode 'V123'`, `item "Race Day Singlet (Men's)"`, `size 'S'`, `total 50`, `orderTotal 50`, `lineIndex 0`, `lineCount 1`).
  - two lines: Men's S + Women's M ×2 with Zelle → two POSTs both `payMethod 'Zelle'`, each with its own `fit`/`size`, shared `orderTotal 150`; reset clears the chips and label; a fresh cut + size + name + email submit is gated again.
  - closed (`Date.now` pinned to 2026-09-10): both `#pays` buttons disabled.
  - 375px phone: the two chips share a row, are ≥44px tall, no horizontal overflow.

- [x] **Step 2: Run it, expect failures**

Run: `node check-payment.mjs`
Expected: non-zero exit; Playwright throws on the first `#pays` selector.

- [x] **Step 3: CSS** — after `.sizes .size { … }` add:

```css
  /* Paying with. Two fixed chips inside the fields column, same .size chip so
     the pressed state and tap target match the cut picker. No bottom margin:
     .fields already gaps its children. */
  .pays {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
```

- [x] **Step 4: Markup** — replace the code-field `<label>` with:

```html
          <div class="field">
            <span class="micro" id="pays-label">Paying with</span>
            <div class="pays" id="pays" role="group" aria-labelledby="pays-label"></div>
          </div>
          <label class="field">
            <span class="micro" id="code-label">Payment confirmation code (optional)</span>
            <input id="f-code" name="code" type="text" class="mono" placeholder="Speeds up matching" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
          </label>
```

- [x] **Step 5: JS**

In `CONFIG`, after the `sizes:` line:

```js
    payMethods:  ['Zelle', 'Venmo'],
```

`state` becomes:

```js
  var state = { fit: '', size: '', qty: 1, pay: '', lines: [], sending: false };
```

After `renderChips(sizesEl, CONFIG.sizes, …);`:

```js
  // ---- paying with ----
  // Required, no default: the page cannot tell which app a buyer opened (on
  // desktop the Zelle path is a QR code with no click at all), and the sheet
  // needs it to say where to look for the transfer. The code field's label
  // follows the pick so nobody types a Venmo ID into a box that says Zelle.
  var paysEl = $('pays'), codeLabelEl = $('code-label');
  function codeLabelFor(pay) {
    if (pay === 'Zelle') return 'Zelle confirmation code (optional)';
    if (pay === 'Venmo') return 'Venmo transaction ID (optional)';
    return 'Payment confirmation code (optional)';
  }
  function syncCodeLabel() { setText(codeLabelEl, codeLabelFor(state.pay)); }
  renderChips(paysEl, CONFIG.payMethods, function (v) { state.pay = v; syncCodeLabel(); });
```

In the submit handler, after the email check:

```js
    if (!state.pay) return setError("Pick how you're paying.");
```

In the payload map, after `zelleCode: codeEl.value.trim(),`:

```js
        // Sent alongside the older item/zelleCode so a script that has not
        // been republished still records a row instead of dropping the order.
        fit: l.fit,
        payMethod: state.pay,
        paymentCode: codeEl.value.trim(),
```

In the reset handler, after `state.qty = 1;`:

```js
    state.pay = '';
```

and after `clearChips(sizesEl);`:

```js
    clearChips(paysEl);
    syncCodeLabel();
```

- [x] **Step 6: Run the new suite, expect all PASS**

Run: `node check-payment.mjs`
Expected: every line `PASS`, exit 0.

- [x] **Step 7: Patch the older suites for the new gate**

In `check-cart.mjs` and `check-venmo.mjs`, before every `await page.click('#submit');` that is meant to succeed, insert `await page.click('#pays button >> nth=0');`. Leave submits that test the cut/size gate alone (they fail before the payment check). Then run:

```
node check-cart.mjs && node check-venmo.mjs && node check-sizes.mjs && node check-mobile.mjs
```

Expected: all PASS.

- [x] **Step 8: Commit**

```bash
git add preorder.html
git commit -m "Ask which app the buyer paid with, and send it with every line"
```

---

### Task 3: Ship and verify

- [x] **Step 1: Push the site**

```bash
git push origin main
```

- [x] **Step 2: Live smoke**

Run `check-live.mjs` against the deployed page; expect all PASS. Then confirm the live HTML contains `id="pays"`:

```
curl -sL https://saintsrunclub.com/preorder | grep -c 'id="pays"'
```
Expected: `1`.

- [ ] **Step 3: Hand off the two steps only the owner can do**

1. Paste `google-apps-script.gs` into the Apps Script editor and publish a **new version** of the existing deployment.
2. Say so; then run the health GET (expects `closesAt` Sept 9, `open: true`), the curl test POST (expects `{"ok":true}`), `submit-live.mjs` (a labeled order through the real page), read the sheet, and delete the two test rows.
