# Smart-Mobile Car Wash – website + admin

A fast, mobile-first website for **Smart-Mobile Car Wash** (Solwezi, Zambia), with a private admin page where you change prices, photos, service areas, working hours and the FAQ yourself.

- **Public site:** `index.html`. Customers see your services and prices in Kwacha and book through WhatsApp.
- **Admin:** `admin.html`. Only you can log in.
- **Built with:** plain HTML, Bootstrap 5 and JavaScript, plus Firebase (Authentication + Firestore).
- **Cost:** works on the **free Spark plan**. Photos are compressed in your browser and saved in Firestore, so you don't need Cloud Storage or the paid Blaze plan.

---

## Files

| File | What it does |
|---|---|
| `index.html` | Public website |
| `admin.html` | Admin dashboard (login, prices, photos, business info) |
| `css/style.css` | Blue & white design |
| `js/firebase-config.js` | **Paste your Firebase config here** |
| `js/public.js` | Loads prices/photos and builds the WhatsApp booking message |
| `js/admin.js` | Admin dashboard logic |
| `js/image-utils.js` | Resizes and compresses photos in the browser |
| `js/defaults.js` | Default services, areas and FAQ (used by “Load default data”) |
| `firestore.rules` | Security rules: everyone can read, only you can write |
| `firestore.indexes.json` | Database index for the gallery |
| `firebase.json`, `.firebaserc` | Firebase Hosting settings |
| `img/` | Favicon and the picture shown when the link is shared (`og-image.png`) |

---

## Step-by-step setup

### 1. Create a Firebase project (free)
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Give it a name, e.g. `master-mobile-care-wash`.
3. Google Analytics is not needed, so you can switch it off. Click **Create project**.
4. New projects start on the free **Spark** plan. Keep it.

### 2. Turn on email/password login and create your admin user
1. In the left menu: **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, click **Email/Password**, switch on **Enable** (the first switch only), then **Save**.
3. Open the **Users** tab and click **Add user**. Enter your email and a strong password, then click **Add user**.
4. You will see your new user in the list. **Copy the “User UID”** (a long code like `aB3dE...`). You need it in step 5.

> There is no sign-up page on the website on purpose. Only this one account can manage the site.

### 3. Create the Firestore database
1. In the left menu: **Build → Firestore Database → Create database**.
2. **Location:** choose a region close to Zambia, for example **`europe-west1` (Belgium)**. ⚠️ You cannot change this later.
3. Choose **Start in production mode**, then click **Create**. (Our own security rules are uploaded in step 6.)

### 4. Paste your web config into `js/firebase-config.js`
1. Click the **gear icon ⚙ → Project settings**.
2. Scroll to **Your apps** and click the **`</>`** (Web) icon.
3. Give the app a nickname (e.g. `website`). Leave “Firebase Hosting” unticked. Click **Register app**.
4. You will see `const firebaseConfig = { apiKey: "...", ... }`. Copy the values.
5. Open `js/firebase-config.js` and replace the placeholder values (`PASTE_YOUR_API_KEY_HERE`, `your-project-id`, …) with yours. Save the file.

> These values are not secret. It is normal for them to be public. Your data is protected by `firestore.rules`.

### 5. Make yourself the admin (`config/admin`)
1. Go to **Firestore Database → Data**.
2. Click **+ Start collection**. Collection ID: `config`, then **Next**.
3. Document ID: `admin`.
4. Add a field: name `uid`, type **string**, value = **the User UID you copied in step 2**.
5. Click **Save**.

> Tip: if you skip this step, the admin page will show your UID after you log in, with a **Copy** button.

### 6. Install the Firebase CLI and deploy
You need **Node.js** (LTS version) from <https://nodejs.org>. Then open a terminal in this folder:

```bash
npm install -g firebase-tools     # install the Firebase CLI (one time)
firebase login                    # opens the browser to sign in
```

Open `.firebaserc` and replace `your-project-id` with your real **Project ID**. You can find it under ⚙ **Project settings → General**.

The config files are already provided, so you **do not need** `firebase init`. (If you run it anyway, choose *Firestore* and *Hosting*, keep the existing files and do **not** overwrite `index.html`. The public directory is `.`.)

Deploy everything (website + security rules + index):

```bash
firebase deploy
```

When it finishes, it prints your website address, e.g. `https://your-project-id.web.app`. 🎉

> After you change prices or photos in the admin, you do **not** need to deploy again. The site reads them live from Firestore. Only redeploy when you change the code files.

### 7. Log in, load the default data and set your prices
1. Open `https://your-project-id.web.app/admin.html` and log in with the email and password from step 2.
2. Click **Load default data** (only the first time). This creates the 6 services, the Solwezi service areas, working hours and FAQ.
3. **Prices & services** tab: type your prices in Kwacha for each vehicle size (car services) or the price + unit (home services). Click **Save** on each service.
   - An empty price shows **“Ask for quote”** on the website.
   - Switch off **Show on website** to hide a service.
4. **Photos** tab: upload the hero banner, your logo, a photo for each service and gallery photos. You will see a preview and the compressed size before saving.
5. **Reviews** tab: when a happy customer sends you feedback, add it here (ask them first if you may show their first name). The reviews section appears on the website once at least one review is switched on.
6. **Business info** tab: check the phone/WhatsApp number, working hours, areas and FAQ. Click **Save business info**.
7. Open the website and test a booking with **Send on WhatsApp**.

**Forgot your password?** On the login page, type your email and tap **Forgot password?**. Firebase sends you a reset link.

### 8. Connect your own domain later (e.g. `mastermobilecarewash.com`)
1. Buy a domain from any registrar (e.g. Namecheap, GoDaddy, or a Zambian `.co.zm` registrar).
2. In Firebase: **Build → Hosting → Add custom domain**. Type your domain and follow the steps.
3. Firebase shows you DNS records (TXT and A records). Add them in your registrar's DNS settings.
4. Wait for verification (from a few minutes to 24 hours). Firebase sets up free HTTPS automatically.
5. Under **Authentication → Settings → Authorized domains**, add your new domain so that admin login works there.
6. In `index.html`, replace every `https://YOUR-SITE-URL/` with your real address (canonical, Open Graph and JSON-LD tags), then run `firebase deploy` again.

---

## Testing on your computer (optional)

**Quick look (no database):**
```bash
npx serve .
```
Open the address it prints. Until your config is pasted, the site shows the default services with “Ask for quote” and a friendly notice. All WhatsApp and Call buttons still work.

**Full local test with fake data (Firebase Emulator Suite, needs Java):**
```bash
firebase emulators:start --project demo-master-mobile
```
Then open <http://localhost:5000/admin.html?emulator> and <http://localhost:5000/?emulator>. Create a test user in the Emulator UI (<http://localhost:4000/auth>), then add `config/admin` with that UID in <http://localhost:4000/firestore>. The `?emulator` part makes the pages use the local emulators instead of your real project.

---

## How the data is stored (Firestore)

| Path | Fields |
|---|---|
| `services/{id}` | `name`, `category` ("car" or "home"), `description`, `bullets[]`, `active`, `order`, `imageId`, and either `prices: {small, suv, van, truck}` (car) or `price` + `unit` (home). An empty price is stored as `null`. |
| `images/{id}` | `dataUrl`, `type` ("service", "gallery", "hero" or "logo"), `caption`, `label` ("", "before" or "after"), `order`, `createdAt`. Hero = `images/hero`, logo = `images/logo`, service photo = `images/svc_{serviceId}`. |
| `settings/business` | `phone`, `whatsapp` (digits only, e.g. `260974286757`), `areas[]`, `hours`, `faq[]` (`{q, a}`) |
| `reviews/{id}` | `name`, `text`, `rating` (1–5), `active` (shown on website or not), optional `area`, `service`, `order`. Added in the admin **Reviews** tab. Visitors can only read reviews that are switched on. |
| `config/admin` | `uid`. Readable only by the admin and **never writable from the website**. |

**Security rules:** anyone can read services, images and settings. Only the user whose UID is in `config/admin` can create, change or delete them. The rules check field types, price values (positive or empty) and image size (each image is under ~900 KB of text, so it stays below Firestore's 1 MB document limit).

**Free-plan limits:** Spark gives 50,000 document reads per day. Each visit uses roughly 10–30 reads (more if your gallery has many photos), so a few thousand visits a day stays free. Keep the gallery to about 20–30 good photos.
