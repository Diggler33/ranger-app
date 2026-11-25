# Ranger App – Keswick Red Squirrel Group

A phone app for recording ranger visits. It's a web page you add to your Home Screen, so there's no app store. It works with no signal: each visit is saved on the phone and sent to the group's Google Sheet when there's a connection.

Each visit records the same fields as `KRSG_VISIT_REPORTING.xlsx`: Visit Date, Location, Method, Funds Method, Reds, Grey Male, Grey Female, Grey Unknown, Hours Worked and Notes. The app adds TotalGreys and Quarter, and also records Ranger, Grid Ref, Latitude, Longitude and Entry ID. Entry ID stops a visit being added to the sheet twice.

## How it fits together

```
Ranger's phone (Ranger App, offline-first)
        │  sends visits when online
        ▼
Google Apps Script web app (apps-script/Code.gs)
        │
        ▼
Group Google Sheet: Visits · Locations · Users · Methods
        │  (published CSV, as now)
        ▼
KRSG_VISIT_REPORTING.xlsx
```

## One-off setup (organiser)

### 1. Prepare the Google Sheet
Use the Sheet that already feeds the Excel file, or a new one. It needs these tabs:
- **Visits**: the app finds columns by their header names and adds any missing ones at the right-hand end.
- **Locations**: `LOCATION | GRID REFERENCE | TRUST Y/N`. This is the app's drop-down list. Edit it here and phones pick up the change.
- **Users**: `Email Address | Name`. These are the suggested names in the app.
- **Methods** (optional): list the methods in column A. Without it the app offers Shoot, Trap and Survey.

### 2. Add the script
1. In the Sheet, go to **Extensions → Apps Script**. Delete what's there, then paste in all of `apps-script/Code.gs`. Save.
2. **Project Settings (⚙) → Script properties → Add**: name it `ACCESS_CODE` and give it a value such as a group password. Leave the time zone as *Europe/London*.
3. Select `testSetup` and press **Run**. Allow the permissions it asks for. The log should show how many locations it found.
4. **Deploy → New deployment → Web app**. Set *Execute as*: **Me**. Set *Who has access*: **Anyone**. Then **Deploy** and copy the URL that ends in `/exec`.
   - "Anyone" means anyone who has the URL. They also need the access code before they can read or add anything.
   - If you change the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

### 3. Put the app online
The app is a folder of static files. It needs an **https** address, because phones only share GPS with secure pages. Any free static host works. The simplest is **GitHub Pages**:
1. Create a repository (e.g. `ranger-app`) and upload everything in this folder.
2. **Settings → Pages → Deploy from branch → main / root**. The app will be at `https://<you>.github.io/ranger-app/`.

Netlify, Cloudflare Pages or the group's own website also work.

### 4. Connect and invite rangers
1. Open the app on your phone, go to **Settings → Advanced / organiser**, paste the web app URL and the access code, then tap **Save & test**.
2. Tap **Share setup with rangers**. This creates a message with the app link and a *setup code*. Send it by WhatsApp or email.

## For rangers
1. Open the link from the organiser.
   - **iPhone:** Safari → Share → **Add to Home Screen**.
   - **Android:** Chrome → ⋮ → **Add to Home screen / Install app**.
2. Open **Ranger** from your Home Screen, go to **Settings**, type your name and tap **Save**. If it says *Not connected*, paste the setup code and tap **Connect**. iPhones keep Home Screen apps separate from Safari, so this step is usually needed on iPhone.
3. To record a visit, choose the location in one of three ways:
   - pick it from the list
   - tap **📍 Nearest**
   - open **🗺️ Map**, which opens at your current position. Tap a dot, or drop a pin and name a new location.

   Then set the method, the counts and the hours, and tap **Save visit**.
4. The badge at the top shows how many visits are waiting to send. **Visits** shows what's on this phone. Use **Export CSV** if you ever need a copy.

## Notes
- The map uses OpenStreetMap, OpenTopoMap and Esri satellite tiles. It needs signal. Everything else works offline.
- Grid references are converted to and from GPS with the Ordnance Survey formulas. They're accurate to about 10 m, and a 6-figure reference is a 100 m square.
- When a ranger saves a new location from the map, it's added to the **Locations** tab with its grid reference. Turn this off with `ADD_NEW_LOCATIONS = false` in `Code.gs`.
- When you change any app file, bump `VERSION` in `sw.js` and the `?v=` numbers in `index.html` and `sw.js`. Otherwise phones keep the old copy.
