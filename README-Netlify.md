
Ticketera — Netlify Functions + Google Sheets (Preventa OCTUBRE)

Estructura
----------
/site
  index.html              → Frontend que consume /.netlify/functions/*
  /data/butacas.csv       → (opcional) CSV seed para bootstrap
/netlify/functions
  status.js   → GET estados (libre/hold/ocupado) + limpieza de holds vencidos
  hold.js     → POST hold 10' (requiere sessionId)
  release.js  → POST liberar hold propio
  confirm.js  → POST marcar ocupado (admin; requiere Authorization Bearer ADMIN_TOKEN)
  bootstrap.js→ GET importar CSV seed a Google Sheets (admin; ?secret=ADMIN_TOKEN)
netlify.toml
package.json

Variables de entorno (en Netlify → Site configuration → Environment variables)
-------------------------------------------------------------------------------
GOOGLE_SERVICE_ACCOUNT_EMAIL=<email de tu service account>
GOOGLE_SERVICE_ACCOUNT_KEY=<private_key del JSON; con \n escapados>
GOOGLE_SHEET_ID=<ID de tu Google Sheet>
SHEET_NAME=Entradas
ADMIN_TOKEN=<poné un token admin, ej: 32 chars>

Pasos
-----
1) Subí este repo/carpeta a Netlify (Deploy manual o desde Git).
2) Cargá las variables de entorno de arriba.
3) Creá en Google Sheets una pestaña "Entradas" con columnas:
   Sector | Fila | Asiento | Precio | Estado | HoldUntil | HoldBy | LastUpdate
4) (Opcional) Hacé seed desde el CSV subido a /site/data/butacas.csv:
   Abrí: https://TU-SITIO.netlify.app/.netlify/functions/bootstrap?secret=ADMIN_TOKEN
   (Reemplazá TU-SITIO y ADMIN_TOKEN). Esto sobreescribe toda la hoja.
5) Abrí el sitio: https://TU-SITIO.netlify.app
   El front hará polling a /status y usará /hold y /release para bloquear/desbloquear.
   El admin confirma la compra llamando a /confirm con Authorization: Bearer ADMIN_TOKEN.

Notas
-----
- Los holds vencen a los 10 minutos. 'status' limpia los vencidos automáticamente.
- El front exige mínimo 5 butacas para habilitar "Comprar".
- Los precios ya están cargados en el CSV y se guardan en la hoja en 'Precio'.
- Transferencia: JAZMIN MAMARIAN — CVU 0000069701259241616580 — Garpa S.A.
