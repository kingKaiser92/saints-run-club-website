# Payment Method and Full Order Record — Design

**Date:** 2026-09-06
**Status:** Approved
**Page:** `preorder.html` (saintsrunclub.com/preorder), `google-apps-script.gs`

---

## 1. Goal

Buyers pay by Zelle or Venmo, but nothing on the form asks which, so every row
in the Orders sheet looks the same and the club has to search both apps for
each name. Multi-singlet orders also land as rows that carry only the line
total, so matching one transfer to two rows means adding them up by hand.

Record the payment method, and make each row a complete record of its order:
cut split out, order total alongside the line total, and the line's position
in the order. The sheet becomes something you can reconcile and tally without
reading the page's source.

## 2. Decisions

| Question | Decision |
|---|---|
| How the method is captured | A required "Paying with" chip pair, Zelle / Venmo, in panel 03 above the confirmation code field. |
| Default method | None. Submit is blocked with "Pick how you're paying." until one is chosen. |
| Confirmation code field | Kept, optional. Its label follows the pick: "Zelle confirmation code (optional)", "Venmo transaction ID (optional)", or "Payment confirmation code (optional)" before a pick. |
| Sheet layout | New header row: `Timestamp, Name, Email, Cut, Size, Qty, Line Total ($), Order Total ($), Line, Payment, Confirmation Code, Paid?, Source`. `Item` is dropped: it was always "Race Day Singlet" plus the cut. |
| Existing sheet | Kept. It holds only the header row, so the script rewrites row 1 on the first post (or `setupSheet` does it now). No new sheet. |
| Payment panel | Unchanged. Both ways to pay stay visible regardless of the pick. |

**Why a required pick and not inference.** The page cannot see which app the
buyer opened: on desktop the Zelle path is a QR code with no click at all.
Asking is the only reliable signal, and it is one tap.

**Why keep the old payload fields.** `item` and `zelleCode` keep going out
alongside the new `fit`, `payMethod` and `paymentCode`. A script that has not
been republished still appends a row in today's shape instead of dropping the
order. That failure mode is exactly what lost two days of orders this week.

## 3. UI

Panel 03, between the email field and the code field:

```
PAYING WITH   [ Zelle ] [ Venmo ]        2-column grid, same chips as Cut
Venmo transaction ID (optional)
[ Speeds up matching                 ]
```

Chips use the existing `renderChips` and `.size` styling, hosted in a new
`.pays` container that shares the `.cuts` grid rule. Picking toggles the
label on the code field. Reset clears the pick and restores the neutral label.
The closed state disables the chips with the rest of the form.

## 4. Payload

Each line's POST adds:

| Field | Value |
|---|---|
| `fit` | `"Men's"` or `"Women's"` |
| `payMethod` | `"Zelle"` or `"Venmo"` |
| `paymentCode` | the code field, trimmed |

`item`, `zelleCode`, `orderTotal`, `lineIndex`, `lineCount` and the rest are
unchanged.

## 5. Script

`HEADERS` becomes the new layout. `doPost` maps a post to a row as:

| Column | Source |
|---|---|
| Cut | `d.fit`, else the parenthesised part of `d.item`, else `''` |
| Qty | `d.quantity`, default 1 |
| Line Total ($) | `d.total` |
| Order Total ($) | `d.orderTotal`, else `d.total` |
| Line | `(lineIndex + 1) + ' of ' + lineCount`, else `'1 of 1'` |
| Payment | `d.payMethod`, else `''` |
| Confirmation Code | `d.paymentCode`, else `d.zelleCode`, else `''` |
| Paid? | `false`, then `insertCheckboxes` on column L |

`ensureHeaders(sh)` runs on every post: an empty sheet gets the header row; a
sheet whose row 1 differs from `HEADERS` and has no order rows beneath it gets
row 1 rewritten; anything else is left alone. It never throws, so a header
mismatch can never cost an order. `setupSheet` keeps its refuse-if-data guard.

The heads-up email gains the payment method and the order total.

## 6. Testing

- **Page (Playwright, local server):** chips render; submit blocked without a
  method and the note reads "Pick how you're paying."; label text tracks the
  pick and resets; one-line and two-line orders carry `fit`, `payMethod`,
  `paymentCode` and the unchanged fields on every POST; reset clears the pick.
- **Script (Node harness):** stub `SpreadsheetApp`, `LockService`, `MailApp`,
  `ContentService`; load the real `.gs`; assert the exact row appended for a
  new-shape post, an old-shape post (no `fit`/`payMethod`), a second line of
  a two-line order, and the header rewrite on a header-only sheet.
- **Regression:** the existing cart, Venmo, sizes and mobile suites.

## 7. Rollout

1. Paste the new `google-apps-script.gs` into the Apps Script editor and
   publish a **new version** of the existing deployment.
2. Push the site.

Either order is safe. Site first: rows land in today's columns until the
republish. Script first: `ensureHeaders` rewrites the empty sheet's headers and
old-shape posts still map cleanly.
