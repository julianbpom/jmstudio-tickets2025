// netlify/functions/checkout.js
import { google } from 'googleapis';

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_KEY,
  GOOGLE_SHEET_ID,
  SHEET_NAME = 'Entradas',
} = process.env;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

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

async function readAll(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });
  const rows = data.values || [];
  const headers = rows.shift() || [];
  const objs = rows.map((r, i) => {
    const o = {};
    headers.forEach((h, idx) => (o[h] = r[idx]));
    o._rowIndex = i + 2; // header en fila 1
    o.Fila = Number(o.Fila);
    o.Asiento = Number(o.Asiento);
    o.Precio = Number(o.Precio || 0);
    return o;
  });
  return { headers, objs };
}

async function writeRow(sheets, seat) {
  const range = `${SHEET_NAME}!A${seat._rowIndex}:I${seat._rowIndex}`;
  const row = [
    seat.Sector,
    seat.Fila,
    seat.Asiento,
    seat.Precio,
    seat.Estado || '',
    seat.HoldUntil || '',
    seat.HoldBy || '',
    seat.LastUpdate || '',
    seat['Alumno/a'] || '',
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

const nowIso = () => new Date().toISOString();
const plusMin = (iso, m) => { const d = iso ? new Date(iso) : new Date(); d.setMinutes(d.getMinutes() + m); return d.toISOString(); };

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok:false, error:'Method Not Allowed' }) };
    if (!GOOGLE_SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

    const { sessionId, alumno } = JSON.parse(event.body || '{}');
    const sid = (sessionId || '').trim();
    const alumnoName = (alumno || '').trim();
    if (!sid || !alumnoName) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'Missing params' }) };

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const { objs } = await readAll(sheets);

    // limpia vencidos (Hold o Pendiente)
    const now = nowIso();
    for (const s of objs) {
      if ((s.Estado === 'Hold' || s.Estado === 'Pendiente de confirmación') && s.HoldUntil && new Date(s.HoldUntil) < new Date(now)) {
        s.Estado = 'Libre';
        s.HoldBy = '';
        s.HoldUntil = '';
        s.LastUpdate = now;
        await writeRow(sheets, s);
      }
    }

    const affected = [];
    for (const s of objs) {
      if (s.Estado === 'Hold' && (s.HoldBy || '') === sid) {
        s.Estado = 'Pendiente de confirmación';
        s['Alumno/a'] = alumnoName;
        s.LastUpdate = now;
        // mantenemos la misma ventana: si no tuviera, la ponemos a +10
        s.HoldUntil = s.HoldUntil && new Date(s.HoldUntil) > new Date(now) ? s.HoldUntil : plusMin(now, 10);
        await writeRow(sheets, s);
        affected.push({ Sector: s.Sector, Fila: s.Fila, Asiento: s.Asiento });
      }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, count: affected.length, seats: affected }) };
  } catch (err) {
    console.error('CHECKOUT ERROR', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error: String(err?.message || err) }) };
  }
};
