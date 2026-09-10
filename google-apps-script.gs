// ---------------------------------------------------------------------------
// SAINTS RUN CLUB - singlet preorder endpoint
// Paste into Extensions > Apps Script on your Google Sheet, then Deploy.
// Full walkthrough: PREORDER-SETUP.md in the site repo.
// ---------------------------------------------------------------------------

var SHEET_NAME   = 'Orders';
var NOTIFY_EMAIL = 'svintsrunclub@gmail.com';  // '' to disable the heads-up email
// Editing this file (or the copy in the Apps Script editor) changes nothing
// on the live URL until you publish a new version: Deploy > Manage deployments
// > pencil > Version: New version > Deploy. A stale deployment keeps enforcing
// whatever CLOSES_AT it was published with, and because the page posts with
// no-cors it cannot see the "closed" rejection: buyers get a success receipt
// and no row is written. GET the /exec URL to see which value is live.
var CLOSES_AT    = '2026-09-14T00:00:00-04:00'; // must match CONFIG.closesAt

// One row per singlet line. A two-singlet order is two rows that share a
// timestamp, name, email, order total and confirmation code; "Line" says
// which is which. To match a transfer, find the name and read Order Total.
var HEADERS = [
  'Timestamp', 'Name', 'Email', 'Cut', 'Size', 'Qty',
  'Line Total ($)', 'Order Total ($)', 'Line', 'Payment',
  'Confirmation Code', 'Paid?', 'Source'
];
var PAID_COL = HEADERS.indexOf('Paid?') + 1;

// Column A only ever holds a real order's timestamp, so it is the one safe
// signal for "does this sheet hold orders". getLastRow() is not: the Paid?
// checkboxes are non-blank cells.
function countOrderRows(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var stamps = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < stamps.length; i++) if (stamps[i][0] !== '') n++;
  return n;
}

function writeHeaders(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#0A0A0A').setFontColor('#FFC30B');
  sh.setFrozenRows(1);
}

// Row 1 has to match HEADERS for appendRow's positional columns to mean what
// the header says. An empty sheet gets the header row. A sheet whose row 1 is
// an older layout and holds no orders yet gets row 1 rewritten. A sheet that
// already holds orders is left alone and the row is appended anyway: a stale
// header is something to fix by hand, never a reason to drop an order.
function ensureHeaders(sh) {
  if (sh.getLastRow() === 0) { writeHeaders(sh); return; }
  var row1 = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  for (var i = 0; i < HEADERS.length; i++) {
    if (row1[i] !== HEADERS[i]) {
      if (countOrderRows(sh) === 0) {
        var width = Math.max(HEADERS.length, sh.getLastColumn());
        sh.getRange(1, 1, 1, width).clearContent();
        writeHeaders(sh);
      }
      return;
    }
  }
}

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  // One-time setup, but nothing stops someone running it again months later.
  // sh.clear() below would silently wipe every preorder captured so far, with
  // real payments already made against those rows. Refuse instead.
  var dataRows = countOrderRows(sh);
  if (dataRows > 0) {
    throw new Error(
      'setupSheet refused to run: sheet "' + SHEET_NAME + '" already has ' +
      dataRows + ' order row(s). Running setup again would erase them. ' +
      'If you genuinely want to start over, delete or rename this sheet ' +
      'first, then run setupSheet again to create a fresh one.'
    );
  }

  sh.clear();
  writeHeaders(sh);
  sh.autoResizeColumns(1, HEADERS.length);
}

// The cut arrives as its own field from the current page. Older posts carried
// it only inside item, as "Race Day Singlet (Women's)".
function cutOf(d) {
  if (d.fit) return d.fit;
  var m = /\(([^)]+)\)\s*$/.exec(d.item || '');
  return m ? m[1] : '';
}

// One sheet row from one posted line. Every fallback here exists so that a
// post from an older version of the page still lands as a sensible row.
function rowFor(d) {
  var qty = d.quantity || 1;
  var total = (d.total === undefined || d.total === '') ? '' : d.total;
  var orderTotal = (d.orderTotal === undefined || d.orderTotal === '') ? total : d.orderTotal;
  var lineIndex = d.lineIndex === undefined ? 0 : d.lineIndex;
  var lineCount = d.lineCount || 1;
  return [
    d.timestamp ? new Date(d.timestamp) : new Date(),
    d.name || '',
    d.email || '',
    cutOf(d),
    d.size || '',
    qty,
    total,
    orderTotal,
    (lineIndex + 1) + ' of ' + lineCount,
    d.payMethod || '',
    d.paymentCode || d.zelleCode || '',
    false,
    d.source || ''
  ];
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = JSON.parse(e.postData.contents);

    // Honeypot. A real buyer never sees this field, so anything in it is a bot.
    // Return ok so the caller learns nothing from being rejected.
    if (d.company) return json({ ok: true });

    // The client clock is trivially wrong or spoofed, so the deadline is
    // enforced here too.
    if (new Date().getTime() >= new Date(CLOSES_AT).getTime()) {
      return json({ ok: false, error: 'closed' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders(sh);
    var row = rowFor(d);
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), PAID_COL).insertCheckboxes();

    // Wrapped: a mail quota failure must never cost the row that was written.
    // A multi-singlet order arrives as one POST per line (see
    // PREORDER-SETUP.md), each carrying lineIndex, so only the first line
    // sends the heads-up. Older single-line posts have no lineIndex and
    // still send.
    var firstLine = d.lineIndex === undefined || d.lineIndex === 0;
    if (NOTIFY_EMAIL && firstLine) {
      try {
        MailApp.sendEmail(
          NOTIFY_EMAIL,
          'Singlet preorder - ' + (d.name || 'unknown'),
          [
            d.name, d.email,
            (row[3] || 'Singlet') + ' ' + row[4] + ' x ' + row[5] + ' ($' + row[6] + ')',
            'Order total: $' + row[7] + (row[8] === '1 of 1' ? '' : ' across ' + (d.lineCount || 1) + ' lines'),
            'Paying with: ' + (row[9] || 'not stated'),
            'Confirmation code: ' + (row[10] || '-')
          ].join('\n')
        );
      } catch (mailErr) {}
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Health check. closesAt and open expose what the *deployed* version is
// enforcing, so a stale deployment can be spotted with a plain GET instead of
// by noticing that orders stopped arriving.
function doGet() {
  var now = new Date().getTime();
  var closes = new Date(CLOSES_AT).getTime();
  return json({
    ok: true,
    service: 'saints-preorder',
    closesAt: CLOSES_AT,
    open: now < closes,
    serverTime: new Date().toISOString()
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
