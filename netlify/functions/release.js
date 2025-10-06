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
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helpers
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
    const rowObj = {};
    headers.forEach((h, idx) => (rowObj[h] = r[idx]));
    rowObj._rowIndex = i + 2; // fila real en la hoja
    rowObj.Fila = Number(rowObj.Fila);
    rowObj.Asiento = Number(rowObj.Asiento);
    rowObj.Precio = Number(rowObj.Precio || 0);
    return rowObj;
  });
  return { headers, objs };
}

async function writeRow(sheets, seatObj) {
  const range = `${SHEET_NAME}!A${seatObj._rowIndex}:H${seatObj._rowIndex}`;
  const row = [
    seatObj.Sector,
    seatObj.Fila,
    seatObj.Asiento,
    seatObj.Precio,
    seatObj.Estado || '',
    seatObj.HoldUntil || '',
    seatObj.HoldBy || '',
    seatObj.LastUpdate || '',
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

function nowIso() { return new Date().toISOString(); }

export async function handler(event) {
  try {
    // CORS / preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const sector = (body.sector || body.Sector || '').toString().trim();
    const fila = Number(body.fila ?? body.Fila);
    const asiento = Number(body.asiento ?? body.Asiento);
    const sessionId = (body.sessionId || '').toString().trim();

    if (!sector || !fila || !asiento || !sessionId) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: 'Missing params' }),
      };
    }
    if (!GOOGLE_SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const { objs } = await getSheetValues(sheets);

    const seat = objs.find(
      (x) => x.Sector === sector && x.Fila === fila && x.Asiento === asiento
    );
    if (!seat) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ ok: false, error: 'Seat not found' }) };
    }

    // Sólo puede liberar quien tiene el hold
    if (seat.Estado === 'Hold' && seat.HoldBy && seat.HoldBy !== sessionId) {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, error: 'Seat held by another session' }) };
    }

    // Si ya está libre, devolvemos ok idempotente
    if (seat.Estado === 'Libre' || !seat.Estado) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // Liberar
    seat.Estado = 'Libre';
    seat.HoldBy = '';
    seat.HoldUntil = '';
    seat.LastUpdate = nowIso();

    await writeRow(sheets, seat);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('RELEASE ERROR', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: String(err && err.message || err) }),
    };
  }
}
