// netlify/functions/release.js
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

function getAuth() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_KEY) throw new Error('Missing service account env vars');
  const key = GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n');
  return new google.auth.JWT(GOOGLE_SERVICE_ACCOUNT_EMAIL, undefined, key, ['https://www.googleapis.com/auth/spreadsheets']);
}

async function readAll(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });
  const rows = data.values || [];
  const headers = rows.shift() || [];
  const objs = rows.map((r, i) => {
    const o = {}; headers.forEach((h, idx) => (o[h] = r[idx]));
    o._rowIndex = i + 2;
    o.Fila = Number(o.Fila); o.Asiento = Number(o.Asiento); o.Precio = Number(o.Precio || 0);
    return o;
  });
  return { headers, objs };
}
async function writeRow(sheets, seat) {
  const range = `${SHEET_NAME}!A${seat._rowIndex}:I${seat._rowIndex}`;
  const row = [
    seat.Sector, seat.Fila, seat.Asiento, seat.Precio,
    seat.Estado || '', seat.HoldUntil || '', seat.HoldBy || '', seat.LastUpdate || '',
    seat['Alumno/a'] || '',
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [row] },
  });
}
const nowIso = () => new Date().toISOString();

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
    if (event.httpMethod === 'GET') return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, method:'GET', hint:'release alive' }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok:false, error:'Method Not Allowed' }) };
    if (!GOOGLE_SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

    const { sector, Sector, fila, Fila, asiento, Asiento, sessionId } = JSON.parse(event.body || '{}');
    const sec = (sector || Sector || '').trim();
    const fi  = Number(fila ?? Fila);
    const ai  = Number(asiento ?? Asiento);
    const sid = (sessionId || '').trim();
    if (!sec || !fi || !ai || !sid) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'Missing params' }) };

    const sheets = google.sheets({ version:'v4', auth: getAuth() });
    const { objs } = await readAll(sheets);

    const seat = objs.find(x => x.Sector === sec && x.Fila === fi && x.Asiento === ai);
    if (!seat) return { statusCode: 404, headers: CORS, body: JSON.stringify({ ok:false, error:'Seat not found' }) };

    // sólo libera si el hold es tuyo; si estuviera en "Pendiente", no lo libera
    if (seat.Estado === 'Hold' && seat.HoldBy && seat.HoldBy !== sid) {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok:false, error:'Seat held by another session' }) };
    }

    if (seat.Estado === 'Libre' || !seat.Estado) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true }) };
    }

    // liberar
    seat.Estado = 'Libre';
    seat.HoldBy = '';
    seat.HoldUntil = '';
    seat.LastUpdate = nowIso();
    await writeRow(sheets, seat);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true }) };
  } catch (err) {
    console.error('RELEASE ERROR', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error: String(err?.message || err) }) };
  }
};
