/**
 * E4 canary scanner — the INSTRUMENT under validation.
 *
 * It answers one question about bytes that actually arrived at the collector: does any known
 * canary appear in them, in any encoding inside the declared scope?
 *
 * It is deterministic, knows only the canaries it is given, and has no heuristic for "PII-shaped"
 * data: with an empty canary set it must report nothing. A later privacy claim may only be made with
 * the byte-identical scanner that passed E4, so `SCANNER_VERSION` and the file's SHA-256 are
 * recorded in every run log.
 *
 * DECLARED SCOPE — detected:
 *   numeric classes (PHONE, AADHAAR, OTP): the digit sequence with up to 3 separator characters
 *     [space tab . - ( ) /] between digits, an optional "91" and/or leading "0" prefix, and digit
 *     boundaries on both sides.
 *   DOB: year, month, day in Y-M-D, D-M-Y or M-D-Y order, separators [space tab . - /] or none,
 *     month and day with or without a leading zero, digit boundaries on both sides.
 *   NAME: both tokens in order, case-insensitive, joined by 1-3 of [space tab . _ - +], letter
 *     boundaries on both sides.
 *   in every view: the raw request, percent-decoding (up to 3 passes, "+" as space), JSON \uXXXX and
 *     escape decoding, and base64 decoding of standalone base64 tokens found in any of those views.
 *
 * DECLARED BLIND SPOTS — not detected, by design, and probed in E4 as EXPECTED misses:
 *   a value split across fields · a partial value (e.g. last four digits) · encrypted or arbitrary
 *   transforms (reversal, XOR, ROT) · name tokens in reversed order · a numeric value embedded
 *   inside a longer digit run · base64 fused into surrounding alphanumeric text.
 */
/**
 * Version history. A version string is never reused for different code.
 *   e4-scanner-1  FAILED E4 attempt 1 (100 of 1,800 positives missed, identically in all 10 runs):
 *                 it decoded \uXXXX before \\, mis-parsing a JSON-stringified escape; and it refused
 *                 "=" as a base64 token's left delimiter, so a query value `note=<base64>` was never
 *                 decoded.
 *   e4-scanner-2  single-pass JSON escape decoding; "=" permitted before a base64 token.
 */
export const SCANNER_VERSION = "e4-scanner-2";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Percent-decode tolerantly: malformed sequences are left as they are. */
function percentDecode(s) {
  return s.replace(/\+/g, " ").replace(/(%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * Decode JSON string escapes in ONE left-to-right pass, as a JSON parser does: \uXXXX, \", \\, \/,
 * \b, \f, \n, \r, \t. Decoding \uXXXX before \\ mis-parses a stringified escape; the repeated
 * passes in `viewsOf` peel nested layers one at a time.
 */
const JSON_SIMPLE = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
function jsonUnescape(s) {
  return s.replace(/\\(u[0-9A-Fa-f]{4}|["\\/bfnrt])/g, (_, e) =>
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : JSON_SIMPLE[e]
  );
}

/** Decode standalone base64 tokens into text, keeping only mostly-printable results. */
function base64Views(s) {
  const out = [];
  // "=" may precede a token (a key=value separator); only padding may follow one.
  const tokens = s.match(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{8,}={0,2}(?![A-Za-z0-9+/=_-])/g) || [];
  for (const t of tokens) {
    const normal = t.replace(/-/g, "+").replace(/_/g, "/");
    if (normal.replace(/=+$/, "").length % 4 === 1) continue;
    const text = Buffer.from(normal, "base64").toString("utf8");
    if (!text) continue;
    const printable = [...text].filter((c) => c >= " " && c <= "~").length;
    if (printable / text.length >= 0.9) out.push(text);
  }
  return out;
}

/** Every view the matchers run over. */
export function viewsOf(text) {
  const views = new Set([text]);
  let frontier = [text];
  for (let pass = 0; pass < 3; pass += 1) {
    const next = [];
    for (const v of frontier) {
      for (const d of [percentDecode(v), jsonUnescape(v)]) {
        if (!views.has(d)) {
          views.add(d);
          next.push(d);
        }
      }
    }
    frontier = next;
  }
  for (const v of [...views]) for (const b of base64Views(v)) views.add(b);
  return [...views];
}

const SEP_NUM = "[ \\t.\\-()/]{0,3}";

function numericMatcher(digits) {
  const body = [...digits].map(escapeRe).join(SEP_NUM);
  return new RegExp(`(?<![0-9])(?:91[ \\t.\\-]{0,2})?0?${body}(?![0-9])`);
}

function dobMatcher(iso) {
  const [y, m, d] = iso.split("-");
  const part = (two) => (two.startsWith("0") ? `0?${two[1]}` : two);
  const S = "[ \\t.\\-/]{0,2}";
  const Y = escapeRe(y);
  const M = part(m);
  const D = part(d);
  const orders = [`${Y}${S}${M}${S}${D}`, `${D}${S}${M}${S}${Y}`, `${M}${S}${D}${S}${Y}`];
  return new RegExp(`(?<![0-9])(?:${orders.join("|")})(?![0-9])`);
}

function nameMatcher(name) {
  const [a, b] = name.split(" ");
  return new RegExp(`(?<![A-Za-z])${escapeRe(a)}[ \\t._\\-+]{1,3}${escapeRe(b)}(?![A-Za-z])`, "i");
}

/** Compile matchers once per canary set. */
export function compileCanaries(canaries) {
  return canaries.map((c) => ({
    class: c.class,
    re: c.class === "DOB" ? dobMatcher(c.value) : c.class === "NAME" ? nameMatcher(c.value) : numericMatcher(c.value),
  }));
}

/**
 * Scan one arrival. Returns the sorted list of canary classes found anywhere in it.
 * `arrival` is the collector's record: method, url, rawHeaders, body.
 */
export function scanArrival(arrival, compiled) {
  // Every header is scanned. There is deliberately no way to exclude part of a request.
  const headerLines = [];
  for (let i = 0; i < arrival.rawHeaders.length; i += 2) {
    headerLines.push(`${arrival.rawHeaders[i]}: ${arrival.rawHeaders[i + 1]}`);
  }
  const text = `${arrival.method} ${arrival.url}\n${headerLines.join("\n")}\n\n${arrival.body.toString("utf8")}`;
  const views = viewsOf(text);
  const found = new Set();
  for (const m of compiled) {
    if (views.some((v) => m.re.test(v))) found.add(m.class);
  }
  return [...found].sort();
}
