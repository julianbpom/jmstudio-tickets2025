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
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helpers
function getAuth() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('Missing service account env vars');
  }
  // La key viene con \n escapados: hay que restaurarlos
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
    // guard conversions
    rowObj._rowIndex = i + 2; // +2 por el header (1) y base 1
    rowObj.Fila = Number(rowObj.Fila);
    rowObj.Asiento = Number(rowObj.Asiento);
    rowObj.Precio = Number(rowObj.Precio || 0);
    return rowObj;
  });
  return { headers, objs };
}

async function writeRow(sheets, headers, seatObj) {
  // Escribimos la fila completa A:H para mantener Precio y demás
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
  const range = `${SHEET_NAME}!A${seatObj._rowIndex}:H${seatObj._rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(iso, mins) {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

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

    if (!GOOGLE_SHEET_ID) {
      throw new Error('Missing GOOGLE_SHEET_ID');
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1) Leer toda la hoja
    const { headers, objs } = await getSheetValues(sheets);

    // 2) Limpiar holds vencidos al vuelo
    const now = nowIso();
    const expired = [];
    for (const s of objs) {
      if (s.Estado === 'Hold' && s.HoldUntil && new Date(s.HoldUntil) < new Date(now)) {
        s.Estado = 'Libre';
        s.HoldBy = '';
        s.HoldUntil = '';
        s.LastUpdate = now;
        expired.push(s);
      }
    }
    // Persistir expirados (si hay)
    for (const s of expired) {
      await writeRow(sheets, headers, s);
    }

    // 3) Buscar la butaca
    const seat = objs.find(
      (x) => x.Sector === sector && x.Fila === fila && x.Asiento === asiento
    );
    if (!seat) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ ok: false, error: 'Seat not found' }) };
    }

    // 4) Reglas de hold
    if (seat.Estado === 'Ocupado') {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, error: 'Seat occupied' }) };
    }

    if (seat.Estado === 'Hold' && seat.HoldBy && seat.HoldBy !== sessionId) {
      // hold de otra persona y NO vencido (ya limpiamos vencidos)
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, error: 'Seat on hold by another session' }) };
    }

    // 5) Aplicar hold (10 minutos)
    seat.Estado = 'Hold';
    seat.HoldBy = sessionId;
    seat.HoldUntil = addMinutes(now, 10);
    seat.LastUpdate = now;

    await writeRow(sheets, headers, seat);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, until: seat.HoldUntil }),
    };
  } catch (err) {
    console.error('HOLD ERROR', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: String(err && err.message || err) }),
    };
  }
}
