import { google } from 'googleapis';

export function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

export const SHEET_ID = process.env.GOOGLE_SHEET_ID;
export const SHEET_NAME = process.env.SHEET_NAME || 'Entradas';

export function rowToObj(row) {
  const [Sector, Fila, Asiento, Precio, Estado, HoldUntil, HoldBy, LastUpdate] = row;
  return {
    Sector,
    Fila: Number(Fila),
    Asiento: Number(Asiento),
    Precio: Number(Precio),
    Estado: (Estado || 'Libre').trim(),
    HoldUntil: HoldUntil || '',
    HoldBy: HoldBy || '',
    LastUpdate: LastUpdate || ''
  };
}

export function objToRow(obj) {
  return [
    obj.Sector, obj.Fila, obj.Asiento, obj.Precio,
    obj.Estado, obj.HoldUntil || '', obj.HoldBy || '', obj.LastUpdate || ''
  ];
}
