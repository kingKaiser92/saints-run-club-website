# Preorder Page — Setup & Notes

The singlet preorder page lives at **`preorder.html`** and is reachable at
**`https://saintsrunclub.com/preorder`** (clean URL via `_redirects`).

## Current state: LIVE, capturing to Google Sheets (Route A)

`CONFIG.endpoint` in `preorder.html` points at the deployed Apps Script web app,
so submitted orders append a row to the **Orders** tab and email
`svintsrunclub@gmail.com`.

Sheet: https://docs.google.com/spreadsheets/d/1ovfWa2K9HAZkhEVvlO_CXKQRjSFNIOtsPydhJ3ZgsmY/edit

If you ever need to take capture offline, set `endpoint` back to `''`. That one
value also flips the pre-payment copy, the submit button label, and the receipt
to their honest unwired wording, which tells buyers to put their name and size
in the Zelle memo and DM to confirm. There is no second flag to remember.

**The endpoint is an unauthenticated open write.** "Who has access: Anyone" is
what lets the page post without a login, and the only things standing in front
of it are the honeypot field and the deadline check. That is proportionate for a
three-day club drop; it would not be for anything longer-lived.

---

## Route A — Google Apps Script

Pick this if you want the Google Sheet to be the live system of record. About
five minutes, all of it in a browser.

> **Do this while signed in to the SRC Google account.** Whoever is logged in
> when you create the sheet and deploy the script owns the sheet, the script,
> and the "From" address on the notification emails.

1. Signed in as **SRC**, go to **[sheets.new](https://sheets.new)** and name it
   **"SRC Singlet Preorders"**.
2. **Extensions → Apps Script**.
3. Delete the sample code and paste all of `google-apps-script.gs` from this
   repo.
4. **Run → setupSheet**, and authorize when prompted. This writes the formatted
   header row. Column H becomes a checkbox on each row automatically as
   orders come in — there is nothing to check yet on a fresh sheet.

   > Rerunning `setupSheet` once orders exist is refused, on purpose — it
   > would otherwise wipe every preorder already captured, with real Zelle
   > payments made against those rows.

5. **Deploy → New deployment**, gear icon → **Web app**.
6. **Execute as: Me**, **Who has access: Anyone**. This is what lets the page
   post anonymously; the script only appends a row and emails you.
7. **Deploy**, then authorize. Google asks for two permissions (manage
   spreadsheets, and send email as you) because the script also emails. If you
   see "Google hasn't verified this app", click **Advanced → Go to [project]
   (unsafe)**. That is normal for your own script.
8. Copy the **Web app URL** (`https://script.google.com/macros/s/AKfy.../exec`).
9. In `preorder.html`, set:

   ```javascript
   endpoint: 'https://script.google.com/macros/s/AKfy...../exec',
   ```

10. Commit and deploy the site.

> **`no-cors` caveat.** The page posts to this endpoint with `mode: 'no-cors'`,
> which keeps the request preflight-free but makes the response opaque: the
> page cannot read a status code, only whether the request threw. In practice
> that means the page shows the buyer a success receipt whenever the network
> request itself succeeds, even if the Apps Script side rejected or failed to
> write the row (closed deadline, quota, a bug in the script, etc). Treat the
> sheet, not the receipt, as the source of truth for what was actually
> recorded.

Sheet columns: `Timestamp, Name, Email, Cut, Size, Qty, Line Total ($), Order
Total ($), Line, Payment, Confirmation Code, Paid?, Source`. One row per
singlet line; a two-singlet order is two rows sharing a timestamp, name, email,
order total and confirmation code, with `Line` reading `1 of 2` and `2 of 2`.
**Payment** is Zelle or Venmo, picked by the buyer. **Paid?** is a checkbox you
tick by hand once you match the transfer.

The script repairs the header row itself: an empty sheet, or one whose row 1 is
an older layout with no orders beneath it, gets the current headers on the next
post. A sheet that already holds orders is never rewritten.

The script uses `LockService` (20s) so two people submitting at once cannot
interleave rows, rejects anything with the honeypot filled, and refuses posts
arriving after `CLOSES_AT`. Keep `CLOSES_AT` in the script matching
`CONFIG.closesAt` in the page.

> **If you edit the script later, you must republish it.** Saving in the Apps
> Script editor does not touch the live URL; it keeps running whatever version
> was last deployed. Use **Deploy → Manage deployments → pencil icon → Version:
> New version → Deploy**. Do not create a *new* deployment: that mints a new
> URL and the page silently stops recording.
>
> This bit us on Sept 3, 2026: `CLOSES_AT` was moved to Sept 9 in the repo but
> the deployment was never republished, so from Sept 4 at 9 AM the live script
> answered every order with `{"ok":false,"error":"closed"}`, buyers still saw
> the success receipt (see the `no-cors` caveat above), and nothing reached the
> sheet. Check what is actually live with a plain GET; `closesAt` and `open`
> come from the deployed code, not the repo:
>
> ```sh
> curl -sL "https://script.google.com/macros/s/AKfycbyfof-RDRSonbzwq4CGMl1XSZjB6xeBL0W6G5L2pddzneIt6CUnAUga5CsWr_NhtTG1/exec"
> # {"ok":true,"service":"saints-preorder","closesAt":"2026-09-09T21:00:00-04:00","open":true,...}
> ```
>
> If the response has no `closesAt` field at all, the deployment predates this
> health check and is stale.

> Gmail sends about 100 emails/day on a free account, far more than this drop
> will produce. The sheet is the record; the email is a heads-up. The send is
> wrapped in try/catch, so if mail ever fails the row is still written.

---

## Route B — Supabase

Pick this if you want to skip the browser entirely. Needs no Google account and
no deployment step: the tables can be created directly from a Claude Code
session with the Supabase connection.

The site already depends on this project. `index.html` serves every one of its
images from `izcimioeuohdofzmnahu.supabase.co`, so this adds no new vendor.

**Schema and policy:**

```sql
create table public.singlet_preorders (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  size        text not null,
  quantity    int  not null default 1,
  total       numeric,
  zelle_code  text,
  paid        boolean not null default false,
  item        text,
  source      text
);

alter table public.singlet_preorders enable row level security;

-- Insert only. The publishable key sits in the page, so it must never be able
-- to read the table back: that would expose every buyer's email to anyone who
-- opened devtools.
--
-- with check (paid = false), not (true): `with check (true)` is
-- column-unrestricted, so anyone with the publishable key (it's in the page
-- source) could insert a row claiming paid = true or total = 0 by calling the
-- REST endpoint directly instead of going through the form. Pinning paid to
-- false on insert means every row still has to be marked paid by hand, from
-- the Supabase dashboard, after someone actually matches the Zelle transfer.
create policy "anon can insert orders"
  on public.singlet_preorders for insert
  to anon with check (paid = false);
```

**Deadline, enforced where a client cannot reach:**

```sql
create function public.reject_late_orders() returns trigger as $$
begin
  if now() >= timestamptz '2026-09-09T21:00:00-04:00' then
    raise exception 'preorder closed';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger singlet_preorders_guard
  before insert on public.singlet_preorders
  for each row execute function public.reject_late_orders();
```

The honeypot is dropped client-side before the request is built, so it never
reaches the table.

**Page changes.** Route B needs a different request shape than Route A, because
there is a real response to read:

```javascript
endpoint: 'https://izcimioeuohdofzmnahu.supabase.co/rest/v1/singlet_preorders',
supabaseKey: 'PASTE_THE_PUBLISHABLE_ANON_KEY',
```

and the `fetch` becomes:

```javascript
fetch(CONFIG.endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': CONFIG.supabaseKey,
    'Authorization': 'Bearer ' + CONFIG.supabaseKey,
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify({
    name: payload.name, email: payload.email, size: payload.size,
    quantity: payload.quantity, total: payload.total,
    zelle_code: payload.zelleCode, item: payload.item, source: payload.source
  })
}).then(function (r) { return r.ok ? done() : failed(); }, failed);
```

This is strictly better than Route A on one point: `no-cors` makes the Apps
Script response opaque, so the page assumes success whenever the request does
not throw. Here a real status code is available, so a failed write actually
shows the buyer an error instead of a false receipt.

The Google Sheet then becomes a mirror rather than the live record. Populate it
whenever you want by asking Claude Code to read the table and write the rows.

---

## Whichever route you pick, test it

For Route A, first ask the deployed script directly. The page cannot show you
its answer (`no-cors`), but curl can, and `ok: true` only comes back after the
row has actually been appended:

```sh
EP="https://script.google.com/macros/s/AKfycbyfof-RDRSonbzwq4CGMl1XSZjB6xeBL0W6G5L2pddzneIt6CUnAUga5CsWr_NhtTG1/exec"
curl -sL "$EP"     # health: closesAt and open must match the page
curl -sL -H "Content-Type: text/plain;charset=utf-8" --data @- "$EP" <<'JSON'
{"name":"TEST - delete me","email":"test@saintsrunclub.com","fit":"Men's","size":"M","quantity":1,"total":50,"orderTotal":50,"lineIndex":0,"lineCount":1,"payMethod":"Venmo","paymentCode":"TEST","item":"Race Day Singlet (Men's)","zelleCode":"TEST","source":"curl"}
JSON
# {"ok":true}                        -> a row landed; delete it from the sheet
# {"ok":false,"error":"closed"}      -> the deployed CLOSES_AT has passed: republish
# {"ok":false,"error":"..."}         -> the script threw; the message says where
```

Do not add `-X POST`: curl already POSTs when given `--data`, and forcing the
method makes it re-POST through Google's redirect and fail with a 411.

Then submit one real order through the page and confirm:

1. A row appears with the right size, quantity, and total.
2. The notification email arrives (Route A).
3. The receipt shows the normal wording, not the "not logged automatically" copy.
4. If a real order ever seems to go missing after the endpoint is wired: check
   the honeypot. A password manager can autofill the hidden `company` field
   (it's a real, named `<input>`, just visually hidden, so some autofill
   heuristics catch it), which makes the page treat a genuine buyer as a bot,
   show them the normal success receipt, and silently skip the POST. Nothing
   in the UI tells the buyer this happened.

---

## Multi-singlet orders

A buyer can add several singlets to one order (say a men's S and a women's
M). The page sends **one POST per line**, in the same shape as a single
order, so each line is its own row in the sheet. Rows from one order share
the same timestamp, name, email and Zelle code. Every payload also carries
`orderTotal`, `lineIndex` and `lineCount`; the script uses those to send
one heads-up email per order instead of one per row. A script deployed before
this change still records every row correctly, it just emails once per row.

To match a payment, find the name and read **Order Total ($)**; every row of
that order carries it, and **Payment** says which app to look in. To tally
sizes for the manufacturer, pivot on `Cut` and `Size` summing `Qty`. If a buyer's network dropped mid-submit and they retried, the
duplicate rows share a name and email but not a timestamp.

## Payments

Manual, no processor. Two ways in, both set in `CONFIG`:

- **Zelle** to **Saints Vision LLC** (`saintsvisionllc@gmail.com`). The QR tile
  shows on desktop only; on a phone the email has a one-tap copy button.
- **Venmo** to `@ericsvntiago` via the profile link
  `https://venmo.com/u/ericsvntiago`, which opens the Venmo app on a phone.

Buyers are told to put their full name in the note, then the line summary the
page builds for them ("Men's S, Women's M ×2"). The form asks which one they used, so the sheet's **Payment** column says where
to look; match by name and **Order Total ($)** there.

## Editing content

Prices, sizes, dates, and handles are all in the `CONFIG` object near the top of
the `<script>` block in `preorder.html`. The countdown reads `CONFIG.closesAt`.
If you change that, change `CLOSES_AT` in `google-apps-script.gs` (Route A) or
the trigger function (Route B) to match, or the two will disagree about when the
drop closed. For Route A that change is only live once you **republish a new
version** of the deployment (see the note under Route A); editing the repo file
or the script editor alone does nothing.

## Files

- `preorder.html` — the page. Markup, styles, and logic, self-contained.
- `singlet-assets/` — the 3D asset, the viewer, product artwork, Zelle QR.
  See `singlet-assets/README.md` for how the GLB is built.
- `google-apps-script.gs` — Route A endpoint, ready to paste.
- `_redirects` — contains the `/preorder` rule.
