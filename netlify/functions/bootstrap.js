import { sheetsClient, SHEET_ID, SHEET_NAME, objToRow } from './_shared.mjs';
import Papa from 'papaparse';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CSV_URL = process.env.CSV_URL || '';

function buildCsvUrl(event) {
  if (CSV_URL) return CSV_URL;
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const proto = event.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/data/butacas.csv`;
}

export default async function handler(event) {
  const url = new URL(event.rawUrl || event.url);
  const secret = url.searchParams.get('secret');
  if (!ADMIN_TOKEN || secret !== ADMIN_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const csvUrl = buildCsvUrl(event);
    const res = await fetch(csvUrl);
    if (!res.ok) return new Response(`CSV fetch error: ${res.status}`, { status: 500 });
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      return new Response(JSON.stringify({ ok:false, errors: parsed.errors.slice(0,3) }), { status: 500 });
    }
    const rows = parsed.data || [];

    // map to sheet rows
    const nowISO = new Date().toISOString();
    const sheetValues = rows.map(r => objToRow({
      Sector: String(r.Sector || '').trim(),
      Fila: Number(r.Fila),
      Asiento: Number(r.Asiento),
      Precio: Number(r.Precio || 0),
      Estado: (r.Estado || 'Libre').trim(),
      HoldUntil: '',
      HoldBy: '',
      LastUpdate: nowISO
    }));

    const sheets = sheetsClient();

    // write headers + clear
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:H`
    });

    const header = [['Sector','Fila','Asiento','Precio','Estado','HoldUntil','HoldBy','LastUpdate']];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: header }
    });

    if (sheetValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:H`,
        valueInputOption: 'RAW',
        requestBody: { values: sheetValues }
      });
    }

    return new Response(JSON.stringify({ ok:true, count: sheetValues.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: e.message }), { status: 500 });
  }
}
