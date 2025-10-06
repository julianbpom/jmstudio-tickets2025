// netlify/functions/hold.js
import { google } from 'googleapis';

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_KEY,
  GOOGLE_SHEET_ID,
  SHEET_NAME = 'Entradas',
} = process.env;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getAuth() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('Missing service account env vars');
  }
  const key = GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n');
  return new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    undefined,
    key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function getSheetValues(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });
  const rows = data.values || [];
  const headers = rows.shift() || [];
  const objs = rows.map((r, i) => {
    const o = {};
    headers.forEach((h, idx) => (o[h] = r[idx]));
    o._rowIndex = i + 2; // header = fila 1
    o.Fila = Number(o.Fila);
    o.Asiento = Number(o.Asiento);
    o.Precio = Number(o.Precio || 0);
    return o;
  });
  return { headers, objs };
}

async function writeRow(sheets, seat) {
  const range = `${SHEET_NAME}!A${seat._rowIndex}:H${seat._rowIndex}`;
  const row = [
    seat.Sector,
    seat.Fila,
    seat.Asiento,
    seat.Precio,
    seat.Estado || '',
    seat.HoldUntil || '',
    seat.HoldBy || '',
    seat.LastUpdate || '',
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

const nowIso = () => new Date().toISOString();
const plusMins = (iso, m) => {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() + m);
  return d.toISOString();
};

// ── Handler ───────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  try {
    // OPTIONS: preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS };
    }

    // GET: ping de diagnóstico (para confirmar que la función se invoca)
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, method: 'GET', hint: 'hold alive' }) };
    }

    // Aceptamos sólo POST para hold real
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
    }

    if (!GOOGLE_SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

    const { sector, Sector, fila, Fila, asiento, Asiento, sessionId } = JSON.parse(event.body || '{}');
    const sec = (sector || Sector || '').toString().trim();
    const fi  = Number(fila ?? Fila);
    const ai  = Number(asiento ?? Asiento);
    const sid = (sessionId || '').toString().trim();

    if (!sec || !fi || !ai || !sid) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'Missing params' }) };
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1) leer
    const { objs } = await getSheetValues(sheets);

    // 2) limpiar holds vencidos
    const now = nowIso();
    for (const s of objs) {
      if (s.Estado === 'Hold' && s.HoldUntil && new Date(s.HoldUntil) < new Date(now)) {
        s.Estado = 'Libre'; s.HoldBy = ''; s.HoldUntil = ''; s.LastUpdate = now;
        await writeRow(sheets, s);
      }
    }

    // 3) buscar asiento
    const seat = objs.find(x => x.Sector === sec && x.Fila === fi && x.Asiento === ai);
    if (!seat) return { statusCode: 404, headers: CORS, body: JSON.stringify({ ok:false, error:'Seat not found' }) };

    if (seat.Estado === 'Ocupado') {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok:false, error:'Seat occupied' }) };
    }
    if (seat.Estado === 'Hold' && seat.HoldBy && seat.HoldBy !== sid) {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok:false, error:'Seat on hold by another session' }) };
    }

    // 4) aplicar hold (10 min)
    seat.Estado = 'Hold';
    seat.HoldBy = sid;
    seat.HoldUntil = plusMins(now, 10);
    seat.LastUpdate = now;
    await writeRow(sheets, seat);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, until: seat.HoldUntil }) };
  } catch (err) {
    console.error('HOLD ERROR', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error: String(err?.message || err) }) };
  }
};
