import { sheetsClient, SHEET_ID, SHEET_NAME, rowToObj, objToRow } from './_shared.mjs';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

export default async function handler(event) {
  if (event.httpMethod !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!ADMIN_TOKEN || event.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const { sector, fila, asiento } = JSON.parse(event.body || '{}');
    if (!sector || !fila || !asiento) {
      return new Response(JSON.stringify({ ok:false, reason:'missing_params' }), { status: 400 });
    }
    const sheets = sheetsClient();
    const now = new Date();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:H`,
    });
    const rows = res.data.values || [];
    const idx = rows.findIndex(r =>
      r[0] === sector && Number(r[1]) === Number(fila) && Number(r[2]) === Number(asiento)
    );
    if (idx === -1) return new Response(JSON.stringify({ ok:false, reason:'not_found' }), { status: 404 });

    const r = rows[idx];
    let obj = rowToObj(r);

    obj.Estado = 'Ocupado';
    obj.HoldUntil = '';
    obj.HoldBy = '';
    obj.LastUpdate = now.toISOString();

    const writeRow = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${writeRow}:H${writeRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [objToRow(obj)] }
    });

    return new Response(JSON.stringify({ ok:true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: e.message }), { status: 500 });
  }
}
