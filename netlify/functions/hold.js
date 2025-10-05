import { sheetsClient, SHEET_ID, SHEET_NAME, rowToObj, objToRow } from './_shared.mjs';

export default async function handler(event) {
  if (event.httpMethod !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try {
    const { sector, fila, asiento, sessionId } = JSON.parse(event.body || '{}');
    if (!sector || !fila || !asiento || !sessionId) {
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

    // limpiar hold vencido si aplica
    if (obj.Estado === 'Hold' && obj.HoldUntil) {
      const exp = new Date(obj.HoldUntil);
      if (!isNaN(exp) && exp < now) {
        obj.Estado = 'Libre'; obj.HoldUntil=''; obj.HoldBy='';
      }
    }

    if (obj.Estado === 'Ocupado') {
      return new Response(JSON.stringify({ ok:false, reason:'ocupado' }), { status: 200 });
    }
    if (obj.Estado === 'Hold' && obj.HoldBy && obj.HoldBy !== sessionId) {
      return new Response(JSON.stringify({ ok:false, reason:'hold_by_other' }), { status: 200 });
    }

    const expires = new Date(Date.now() + 10*60*1000);
    obj.Estado = 'Hold';
    obj.HoldUntil = expires.toISOString();
    obj.HoldBy = sessionId;
    obj.LastUpdate = now.toISOString();

    const writeRow = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${writeRow}:H${writeRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [objToRow(obj)] }
    });

    return new Response(JSON.stringify({ ok:true, until: obj.HoldUntil }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: e.message }), { status: 500 });
  }
}
