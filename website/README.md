# Tyrotec website (tyrotec.co.za)

The company website: a plain static site (HTML, CSS, a little JavaScript, images).
It is **separate from the portal** (`frontend/` and `backend/`) and is **not deployed by Render** —
pushing to GitHub does not change the live website.

| File | What it is |
|---|---|
| `index.html`, `about.html`, `services.html`, `gallery.html`, `contact.html` | The five pages |
| `style.css`, `main.js` | Shared styling and behaviour (menu, slider, gallery, enquiry form) |
| `assets/` | Logo and photos |

## Where it lives

`tyrotec.co.za` is served by Apache on separate shared hosting (cPanel or similar), not on Render.
This folder was downloaded from the live site on 12 November 2026, so it was identical to live at that point.

## Publishing a change

1. Edit the files here and commit them (keep website commits separate from portal commits).
2. Log in to the website's hosting (cPanel File Manager or FTP).
3. Upload only the files you changed, into the site's web root (usually `public_html/`), replacing the old ones.
4. Open https://tyrotec.co.za and hard-refresh (Ctrl+F5) to check.

## Changes waiting to be uploaded

Made 12 November 2026, from the client's "Website pointers" document. Upload these five files:
`index.html`, `about.html`, `services.html`, `gallery.html`, `contact.html`.

- The menu's **Contact** link is now **Shop Now**, going straight to the portal's products
  (https://portal.tyrotec.co.za/products); **GET IN TOUCH** still goes to the Contact page.
  The footer gains a **Shop Online** link.
- Business hours now give the days: **Mon – Fri 08:00 – 17:00, Sat – Sun Closed**
  (footer on every page, and the Contact page).

Upload them after the portal update that lets visitors browse without logging in is live,
otherwise **Shop Now** lands on the login page.
