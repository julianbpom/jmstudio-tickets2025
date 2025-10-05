import { sheetsClient, SHEET_ID, SHEET_NAME, rowToObj, objToRow } from './_shared.mjs';

export default async function handler(event) {
  try {
    const sheets = sheetsClient();
    const now = new Date();

    // Leer todo
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:H`,
    });
    const rows = res.data.values || [];
    let changed = false;

    // Limpiar holds vencidos
    const cleaned = rows.map(r => {
      const obj = rowToObj(r);
      if (obj.Estado === 'Hold' && obj.HoldUntil) {
        const exp = new Date(obj.HoldUntil);
        if (!isNaN(exp) && exp < now) {
          obj.Estado = 'Libre';
          obj.HoldUntil = '';
          obj.HoldBy = '';
          obj.LastUpdate = now.toISOString();
          changed = true;
        }
      }
      return objToRow(obj);
    });

    if (changed && cleaned.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:H`,
        valueInputOption: 'RAW',
        requestBody: { values: cleaned }
      });
    }

    const out = cleaned.map(rowToObj);
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
