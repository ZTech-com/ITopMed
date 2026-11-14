# ITop Med — to'liq qo'llanma (0 dan 100% gacha)

Bu hujjat loyiha egasi uchun: tizimda nima bor, uni qanday o'rnatish, ishga tushirish, boshqarish va kundalik ishlatish. Texnik tafsilotlar `docs/ARCHITECTURE.md`, `docs/SECURITY-AND-PRIVACY.md` va `docs/DEPLOYMENT.md` da.

---

## 1. ITop Med nima

ITop Med — klinikalarni boshqarish tizimi. **Bitta dastur hamma uchun:**

| Kim | Misol | Tizim nimani yoqadi |
|---|---|---|
| Xususiy kabinet | 1 kardiolog, ehtimol 1 administrator | Bemorlar, qabul, tibbiy yozuv, to'lov, hisobot, bemor portali |
| Stomatologiya | tish klinikasi | + tish formulasi, stomatologik xizmatlar, ombor |
| Diagnostika / laboratoriya | tahlil markazi | + laboratoriya, ombor |
| Ko'p tarmoqli klinika / shifoxona | ko'p shifokor, bir nechta filial | hamma bo'limlar, kadrlar, filiallar |

Kichik kabinetga keraksiz bo'limlar ko'rinmaydi. Kerak bo'lsa keyin yoqiladi.

### Ikki daraja
1. **Platforma (siz — ITop Med egasi):** `/admin`. Klinikalarni yaratasiz, tariflar va bo'limlarni boshqarasiz, o'z xodimlaringizni taklif qilasiz va audit jurnalini ko'rasiz. **Bemorlarning tibbiy ma'lumotlarini ko'ra olmaysiz** — bu qonun va xavfsizlik talabi, ma'lumotlar bazasi darajasida bloklangan.
2. **Klinika:** `/c/<klinika-nomi>`. Klinika egasi va xodimlari ishlaydigan joy. Har bir klinika boshqasidan to'liq ajratilgan.
3. **Bemor portali:** `/p/<klinika-nomi>`. Bemor o'z qabullarini, chiqarilgan tahlil natijalarini va hisoblarini ko'radi.

---

## 2. Ichida nimalar bor (bo'limlar)

| Bo'lim | Nima qiladi |
|---|---|
| **Bemorlar** | Ro'yxatga olish (tibbiy karta raqami, JShShIR/pasport), xatolarga chidamli qidiruv, dublikatlardan himoya, roziliklar |
| **Qabulga yozish** | Shifokor jadvali bo'yicha bo'sh vaqtlar. Bir vaqtga ikki bemorni yozib bo'lmaydi (baza darajasida) |
| **Navbat** | Kelganini belgilash, navbat raqami, navbatsiz kelganlar |
| **Tibbiy yozuvlar (EMR)** | Ko'rik, shikoyat, tashxis (MKB-10), allergiya, hayotiy ko'rsatkichlar (qon bosimi, puls…). Imzolangan yozuvni o'zgartirib bo'lmaydi, faqat qo'shimcha kiritiladi |
| **Laboratoriya** | Tahlil buyurtmasi, namuna olish, natija, normadan chetga chiqishni belgilash, ikki kishilik tasdiqlash |
| **Hamshira posti** | Namuna olish, hayotiy ko'rsatkichlar |
| **Hisob va to'lovlar, Kassa** | Hisob-faktura, chegirma, naqd/karta/Payme to'lovlari (qo'lda belgilanadi), qaytarish, kassa smenasi, chek |
| **Xarajatlar, Hisobotlar** | Moliya va ish hisobotlari |
| **Dorixona va ombor** | Partiyalar, yaroqlilik muddati, tarqatish, kam qolganlar haqida ogohlantirish |
| **Kadrlar** | Xodim profili, litsenziyalar, ta'tillar (shifokor ta'tilda bo'lsa, unga yozib bo'lmaydi) |
| **Stomatologiya** | Tish formulasi (FDI), har bir tish tarixi |
| **Bemor portali** | Bemor o'zi kiradi: qabullar, natijalar, hisoblar |
| **Bildirishnomalar** | Qabulni eslatish, natija tayyorligi (email; SMS hali simulyatsiya) |
| **Rollar** | Har bir xodimga o'z huquqlari; o'zingiz yangi rol yaratishingiz mumkin |
| **Audit jurnali** | Kim, qachon, nima qildi — o'zgartirib bo'lmaydigan zanjir |
| **Xavfsizlik** | Parol, ikki bosqichli tekshiruv (Google Authenticator va h.k.), tiklash kodlari, urinishlar chegarasi |

**Tayyor rollar:** Klinika egasi, Klinika administratori, Filial rahbari, Registrator, Shifokor, Bosh shifokor, Hamshira, Laboratoriya xodimi, Kassir, Buxgalter, Farmatsevt/ombor, Kadrlar mutaxassisi.

**Tillar:** o'zbekcha (lotin), o'zbekcha (kirill), ruscha, inglizcha. Har bir foydalanuvchi o'zi tanlaydi.

---

## 3. Yangi kompyuterga o'rnatish (bir marta)

**Kerak:** Windows 10/11 (yoki macOS/Linux), [Node.js 22+](https://nodejs.org) (LTS), [Git for Windows](https://git-scm.com) (OpenSSL ham shu bilan keladi). Docker shart emas.

Terminalda (PowerShell yoki Git Bash) ketma-ket:

```bash
git clone https://github.com/ZTech-com/ITopMed.git
```
```bash
cd ITopMed
```
```bash
npm install
```
```bash
npm run setup
```
`setup` tasodifiy parollar va shifrlash kalitlari bilan `.env` faylini yaratadi. **`.env` nusxasini xavfsiz joyda saqlang** (masalan, parol menejerida). Kalitlarsiz zaxira nusxalarni tiklab bo'lmaydi.

Ma'lumotlar bazasini birinchi marta tayyorlash (alohida oynada `npm run db:start` ishlab tursin):
```bash
npm run db:start
```
```bash
npm run db:migrate
```
```bash
npm run db:seed
```
Birinchi platforma administratori (o'zingiz):
```bash
npm run admin:create -- --email siz@pochta.uz --name "Ismingiz" --role SUPER_ADMIN
```
Parolni so'raydi: kamida 12 belgi, harf va raqam bo'lishi kerak.

Shundan keyin `npm run db:start` oynasini yopishingiz mumkin, chunki `npm run local` bazani o'zi ishga tushiradi.

---

## 4. Kompyuterda ilova sifatida (eng oson yo'l)

Bir marta, o'rnatishdan keyin:
```bash
npm run app:shortcut
```
Ish stolida ikkita yorliq paydo bo'ladi:
- **ITop Med**: ikki marta bosing. Server orqa fonda o'zi ishga tushadi (baza, tezkor versiya, bildirishnomalar) va ITop Med alohida oynada, manzil satrisiz, oddiy dastur kabi ochiladi. Birinchi marta va kod yangilangandan keyin 1–3 daqiqa kutasiz, keyingi safar 20–30 soniya. Server allaqachon ishlayotgan bo'lsa, oyna darhol ochiladi.
- **ITop Med - to'xtatish**: serverni to'liq o'chiradi.

Bu kompyuterda sertifikat kerak emas: oyna `http://127.0.0.1:3000` manzilini ochadi, brauzer uni xavfsiz manzil deb hisoblaydi. Oynaning menyusidagi **"Ilovani o'rnatish"** orqali ITop Med'ni Start menyusiga ham qo'shishingiz mumkin.

Terminal orqali ham ishlaydi: `npm run app` (ochish) va `npm run app:stop` (to'xtatish). Server jurnali: `.data/logs/local.log`.

Kompyuter yoqilganda avtomatik ishga tushishi uchun: `Win + R` → `shell:startup` → ochilgan papkaga "ITop Med" yorlig'ining nusxasini qo'ying.

## 4a. Klinikaning butun tarmog'ida, hamma qurilmada

Yorliq (yoki `npm run app`) tarmoq uchun ham HTTPS manzilini ochadi. Terminalda natijani ko'rib ishga tushirish uchun:
```bash
npm run local
```
Bu bitta buyruq:
1. ma'lumotlar bazasini ishga tushiradi;
2. yangi migratsiyalarni qo'llaydi;
3. tezkor production versiyasini yig'adi (birinchi marta 1–2 daqiqa);
4. bildirishnomalar xizmatini ishga tushiradi;
5. tarmoq uchun **HTTPS** manzilini ochadi va ekranda ko'rsatadi, masalan:
```
On this computer:   https://localhost:3443
Other devices:      https://192.168.0.80:3443
```

Kodni yangilaganingizdan keyin `npm run local -- --build` bilan qayta yig'ing. To'xtatish uchun Ctrl+C bosing.

Bu kompyuter **server** vazifasini bajaradi: u yoniq va tarmoqqa ulangan bo'lishi kerak. Telefonlar va boshqa kompyuterlar o'sha Wi-Fi/tarmoqda bo'lishi kerak. Windows birinchi marta "Firewall" ruxsatini so'rasa, **Private network** uchun ruxsat bering.

### 4.1. Sertifikatni har bir qurilmaga bir marta o'rnatish

Tarmoqdagi manzil xavfsiz (HTTPS) bo'lishi uchun ITop Med shu kompyuterda o'zining sertifikat markazini yaratadi:
`.data/certs/itopmed-local-ca.crt`. Bu fayl faqat **ochiq qism**. Maxfiy kalit (`.key`) kompyuterdan hech qachon chiqmasligi kerak, uni hech kimga bermang.

Faylni qurilmaga Telegram (o'zingizga), USB yoki email orqali o'tkazing, keyin:

- **Windows (server kompyuterning o'zi ham):** faylni ikki marta bosing → *Install Certificate* → *Current User* → *Place all certificates in the following store* → **Trusted Root Certification Authorities** → *Finish*. Brauzerni qayta oching.
- **Android:** *Sozlamalar → Xavfsizlik → Shifrlash va hisob ma'lumotlari → Sertifikat o'rnatish → CA sertifikati* → faylni tanlang.
- **iPhone/iPad:** faylni oching → *Sozlamalar → Profil yuklandi → O'rnatish*. Keyin **majburiy:** *Sozlamalar → Asosiy → Ma'lumot → Sertifikatlarga ishonch sozlamalari* → "ITop Med Local CA" ni yoqing.
- **macOS:** faylni oching → Keychain → *Always Trust*.

### 4.2. Ilova sifatida o'rnatish (telefon, planshet, kompyuter)
Manzilni oching (`https://192.168.0.80:3443` kabi), keyin:
- **Android / Chrome / Edge:** menyu → **"Ilovani o'rnatish"** yoki "Bosh ekranga qo'shish";
- **iPhone (Safari):** Ulashish tugmasi → **"Bosh ekranga qo'shish"**.

Ilova alohida oynada, belgisi bilan ochiladi. Internet bo'lmasa, oflayn sahifani ko'rsatadi.

### 4.3. Email
SMTP sozlanmagan bo'lsa, xatlar (taklif havolalari, parol tiklash) server kompyuterdagi **`.dev-mailbox`** papkasiga fayl bo'lib tushadi. Faylni brauzerda ochib, havolani kerakli odamga yuborasiz.
Haqiqiy email uchun `.env` ga `SMTP_URL=smtps://login:parol@smtp.server.uz:465` qo'shing, `npm run local` o'zi SMTP ga o'tadi.

### 4.4. IP manzil o'zgarsa
Sertifikat yangi IP uchun avtomatik qayta chiqariladi. Sertifikat markazi o'zgarmaydi, shuning uchun qurilmalarga qayta o'rnatish shart emas. Doimiy bo'lishi uchun routerda server kompyuterga **doimiy IP** (DHCP reservation) bering.

> **Ishlab chiqish rejimi** (dasturchilar uchun, faqat shu kompyuterda): `npm run db:start` va `npm run dev` → http://localhost:3000.

---

## 5. Birinchi kun: platformadan klinikagacha

### 5.1. Siz (platforma administratori)
1. `https://…:3443/admin/login` sahifasiga email va parol bilan kiring.
2. Birinchi kirishda **ikki bosqichli tekshiruv**ni sozlang: telefonda Google Authenticator / Microsoft Authenticator ilovasini o'rnating, QR kodni skanerlang va 6 xonali kodni kiriting.
3. Darhol **tiklash kodlarini** yarating, yuklab olib xavfsiz joyda saqlang. Telefon yo'qolsa, ular orqali kirasiz.
4. **Klinikalar → Yangi klinika:** klinika nomi, manzil nomi (masalan `shifo-kardio`), tarif va egasining emaili. Egaga taklif havolasi boradi (yoki `.dev-mailbox` ga tushadi).
5. **Platforma xodimlari → Xodimni taklif qilish:** o'z jamoangizni rol bilan taklif qiling (Qo'llab-quvvatlash, Hisob-kitob, Faqat ko'rish va h.k.).

### 5.2. Klinika egasi (misol: kichik kardiologiya kabineti)
1. Taklif havolasini oching, ism va parolni kiriting, keyin `/login` orqali kiring. Ega uchun ikki bosqichli tekshiruv majburiy; sozlagach tiklash kodlarini saqlang.
2. **Sozlash yordamchisi** (bosh sahifada taklif chiqadi):
   - Amaliyot turi: **Xususiy kabinet**;
   - **Amaliyotning asosiy yo'nalishi: Kardiologiya**. Shunda tizim avtomatik ravishda kardiolog konsultatsiyasi, EKG, exokardiografiya, Xolter, qon bosimini 24 soatlik monitoringi va yuklamali sinov xizmatlarini qo'shadi;
   - "Men shu yerda shifokorman" → mutaxassislik: Kardiologiya, Dushanba–Juma 9:00–18:00 jadval;
   - Administrator bo'lmasa: "Registratura va kassani o'zim qilaman".
3. **Xizmatlar va narxlar:** har bir xizmatga narx qo'ying (narxsiz xizmatga hisob chiqarib bo'lmaydi).
4. Kerak bo'lsa **Xodimlar → Taklif qilish:** hamshira, administrator va h.k.
5. Tayyor: bemorni ro'yxatga olish → qabulga yozish → kelganini belgilash → ko'rik → hisob → to'lov.

Boshqa yo'nalishlar uchun ham tayyor xizmatlar to'plami bor: pediatriya, ginekologiya, oftalmologiya, LOR, nevrologiya, dermatologiya, urologiya, endokrinologiya, fizioterapiya, stomatologiya va diagnostika.

---

### 5.3. Kodsiz kirish (faqat tanlangan hisoblar uchun)
`.env` faylidagi `MFA_EXEMPT_EMAILS=` qatoriga yozilgan emaillar 6 xonali kodsiz, **faqat parol bilan** kiradi (platforma ham, klinika ham). Bu egasining ongli istisnosi: shu hisoblarning himoyasi kuchsizroq. Shuning uchun parol uzun va sir bo'lsin. Har bir bunday kirish audit jurnalida `mfaExempt` belgisi bilan yoziladi va hisob xavfsizligi sahifasida ogohlantirish ko'rinadi. O'zgartirgandan keyin `npm run local` (yoki `npm run dev`) ni qayta ishga tushiring.

## 6. Kundalik ish (rollar bo'yicha)

| Rol | Kundalik ish |
|---|---|
| **Registrator** | Bemorni topish yoki ro'yxatga olish → Qabulga yozish → Navbatda "Keldi" deb belgilash. Portal uchun bemorga faollashtirish kodi berish |
| **Shifokor** | "Bugungi bemorlarim" → bemorni chaqirish → ko'rik (shikoyat, ko'rik, tashxis, tavsiya) → kerak bo'lsa tahlil buyurish → **imzolash** |
| **Hamshira** | Hamshira posti: qon bosimi, puls, harorat; tahlil namunasini olish |
| **Laborant** | Natijani kiritish → boshqa xodim tasdiqlaydi → shifokor bemorga chiqaradi |
| **Kassir** | Smenani ochish → to'lov qabul qilish → chek → kun oxirida smenani yopish (pul hisobi mos kelishi kerak) |
| **Ega / buxgalter** | Hisobotlar, xarajatlar, xodimlar, sozlamalar, faoliyat jurnali |
| **Bemor** | `/p/<klinika>` ga telefon raqami va parol bilan kiradi: qabullar (2 soat oldin onlayn bekor qilish mumkin), natijalar, hisoblar |

---

## 7. Siz qanday qilib 100% boshqarasiz

| Vazifa | Qayerda |
|---|---|
| Klinikani yaratish, to'xtatish, qayta yoqish, arxivlash | `/admin/clinics` → klinika |
| Tarifni o'zgartirish, bo'limlarni yoqish/o'chirish | Klinika sahifasi → Tarif / Modullar |
| Egaga taklifni qayta yuborish yoki bekor qilish | Klinika sahifasi → Takliflar |
| Klinikaga yordam berish uchun kirish | Klinika sahifasi → Qo'llab-quvvatlash so'rovi (klinika tasdiqlaydi, vaqt cheklangan, auditda yoziladi) |
| O'z jamoangiz | `/admin/staff`: taklif qilish, telefonini yo'qotgan xodimning MFA'sini qayta o'rnatish (avval shaxsini tasdiqlang!) |
| Kim nima qildi | `/admin/audit` → "Zanjirni tekshirish" (jurnal o'zgartirilmaganini isbotlaydi) |
| O'z xavfsizligingiz | Pastki chapdagi qalqon belgisi → tiklash kodlari |

**Klinika egasi o'z klinikasida:** Xodimlar (rol, filial, to'xtatish, MFA'ni qayta o'rnatish), Rollar va huquqlar, Filiallar, Bo'limlar va xonalar, Shifokorlar va jadval, Xizmatlar va narxlar, Sozlamalar (bo'limlar), Faoliyat jurnali, Qo'llab-quvvatlash kirishi (ITop Med so'rovlarini tasdiqlash yoki rad etish).

---

## 7a. Nazorat markazi va nazorat qoidalari (egasi uchun)

**Nazorat markazi** (chap menyuda, qalqon belgisi) bitta sahifada ko'rsatadi:
- **Bugun:** qabullar soni, kutayotganlar, kelmaganlar, bugungi va oylik tushum (o'tgan oyning shu kunlariga nisbatan %), bemorlarning qarzi;
- **Kassalar:** ochiq smenalar va hozir har bir kassada bo'lishi kerak bo'lgan naqd pul; smena yopilishidagi kamomad va ortiqchalar;
- **Chegirmalar:** kim, necha marta va qancha chegirma bergan (30 kun); pul qaytarishlar va bekor qilingan hisoblar;
- **Klinik intizom:** 24 soatdan ortiq imzolanmagan yozuvlar (shifokor bo'yicha), ochiq qolgan qabullar, hisob chiqarilmagan qabullar;
- **Xavfsizlik:** ikki bosqichli tekshiruvsiz ega/administrator/buxgalterlar, tibbiy kartaga favqulodda kirishlar.

**Nazorat qoidalari** (Sozlamalar → Nazorat qoidalari; faqat ega o'zgartiradi):
- xodim bera oladigan eng katta chegirma foizi (masalan 10%); undan oshsa tizim rad etadi;
- har bir chegirma uchun sabab yozish majburiyligi. Sabab hisobda va nazorat markazida ko'rinadi.
Egaga bu cheklovlar tegishli emas.

## 7b. Retsept va qabulni ko'chirish
- **Retsept:** shifokor qabul sahifasida "Retseptlar" bo'limida dori, doza, qabul tartibi va muddatni yozadi. Bemorda shu dori bilan mos keladigan allergiya qayd etilgan bo'lsa, tizim to'xtatadi va shifokordan alohida tasdiq so'raydi. Retsept tahrirlanmaydi, faqat bekor qilinadi. "Retseptni chop etish" A5 qog'oz retsept chiqaradi (imzo va muhr uchun joy bilan). Milliy elektron retsept tizimiga ulanish hali yo'q.
- **Ko'chirish:** Navbat sahifasida yozilgan qabulning yonidagi "Ko'chirish" tugmasi orqali yangi sana va vaqt tanlanadi. Shifokor jadvali va band vaqtlar xuddi yangi yozilishdagidek tekshiriladi; bemorga eslatma yangi vaqtga moslanadi; tarix audit jurnalida saqlanadi.

## 7c. Bemor portali orqali onlayn yozilish
1. **Shifokorlar va jadval** → shifokor profilida "Onlayn yozilishni qabul qiladi" belgisini yoqing (shifokorning ish jadvali bo'lishi kerak).
2. **Sozlamalar → Nazorat qoidalari → Onlayn yozilish:** necha kun oldindan, hozirdan kamida necha soat keyin, bitta bemorga nechta onlayn qabul (masalan 30 kun, 2 soat, 3 ta).
3. Bemor portalda **"Qabulga yozilish"**: shifokor → kun va bo'sh vaqt → tasdiqlash. Band vaqtlar, dam olish kunlari va ish soatlari avtomatik hisobga olinadi; ikki bemor bir vaqtga yozila olmaydi (baza darajasida).
4. Onlayn yozilgan qabul navbat va qabullar ro'yxatida oddiy qabul kabi ko'rinadi (manbasi: portal). Bemorga tasdiq va eslatma boradi.

## 7d. Telegram xabarnomalari
1. Telegramda **@BotFather** → `/newbot` → nom va "bot" bilan tugaydigan username → token.
2. **Integratsiyalar → Telegram bot** → tokenni joylang → "Botni ulash". Token shifrlanib saqlanadi va qayta ko'rsatilmaydi.
3. Bemor portalda **Hisob → Telegramni ulash** → "Telegramni ochish" → Telegramda **Start**. 20 soniyada ulanadi.
4. Shundan keyin tasdiq, eslatma, bekor qilish va natija tayyorligi haqidagi xabarlar Telegramga ham boradi (tibbiy ma'lumotsiz). Bemor istalgan vaqtda uzishi mumkin.
Telegram server kompyuterda **internet** bo'lishini talab qiladi. Ishlab chiqish rejimida xabarlar simulyatsiya qilinadi (`.dev-mailbox/telegram`).

## 7e. Shablonlar — keraklisini o'zingiz yarating
**Shablonlar** bo'limida (chap menyu) ikki xil narsa yaratasiz:
- **Hujjatlar** — qabul xulosasi, yo'llanma, ma'lumotnoma yoki klinikangizga kerak bo'lgan har qanday chop etiladigan hujjat. Matnga `{{patient.fullName}}`, `{{diagnoses}}`, `{{prescriptions}}`, `{{doctor.fullName}}` kabi maydonlarni qo'yasiz; chop etishda ular qabul ma'lumotlari bilan to'ldiriladi. Maydonlarning to'liq ro'yxati tahrirlash sahifasida bor.
- **Yozuv shablonlari** — shikoyat, anamnez, ko'rik, xulosa va reja bo'limlari uchun tayyor matn (masalan, "Kardiolog konsultatsiyasi"). Kerak bo'lsa faqat bitta mutaxassislik uchun.

Boshlash uchun **"Tayyor shablonlarni qo'shish"** tugmasini bosing — klinika tilida 5 ta shablon qo'shiladi, ularni o'zingizga moslab o'zgartirasiz.
Shifokor qabul sahifasida: **"Shablondan to'ldirish"** (faqat bo'sh bo'limlar to'ldiriladi) va **"Hujjatlar"** kartasidan istalgan hujjatni chop etish.

## 8. Zaxira nusxa (har kuni!)

```bash
npm run backup
```
Shifrlangan nusxa `backups/` papkasiga tushadi. **Nusxani boshqa joyga ham ko'chiring** (tashqi disk yoki boshqa kompyuter). Kalit (`BACKUP_ENCRYPTION_KEY`) nusxa bilan birga saqlanmasin.

Nusxa haqiqatan tiklanishini tekshirish:
```bash
npm run backup:verify -- backups/<fayl>.itmbk
```
Windows "Task Scheduler" orqali `npm run backup` buyrug'ini har kuni avtomatik ishga tushirish tavsiya etiladi.

---

## 9. Yangilash

```bash
git pull
```
```bash
npm install
```
```bash
npm run local -- --build
```
Migratsiyalar `npm run local` ichida avtomatik qo'llanadi. Yangilashdan oldin `npm run backup` qiling.

---

## 10. Muammolar va yechimlar

| Belgi | Sabab va yechim |
|---|---|
| "Your connection is not private" / sertifikat xatosi | Shu qurilmaga sertifikat o'rnatilmagan (4.1) |
| Telefonda sahifa ochilmaydi | Telefon boshqa Wi-Fi'da; server kompyuter o'chiq; Firewall Private network ruxsati yo'q |
| "Too many attempts" | 5–15 daqiqa kuting (xavfsizlik chegarasi) |
| Hisob bloklangan | 5 marta noto'g'ri parol: 15 daqiqa kuting yoki "Parolni unutdingizmi" (klinika xodimlari). Platforma xodimlari parolini Super administrator yoki `admin:create` buyrug'i bilan tiklaydi |
| Telefon (Authenticator) yo'qolgan | Tiklash kodi bilan kiring; kod yo'q bo'lsa administrator MFA'ni qayta o'rnatadi |
| Taklif xati kelmadi | SMTP yo'q: `.dev-mailbox` papkasini oching (4.3) |
| Xizmatga hisob chiqmaydi | Xizmatga narx qo'yilmagan |
| Shifokorga qabul yozib bo'lmaydi | Jadval yo'q, ta'tilda yoki vaqt band |
| `npm run local` "OpenSSL was not found" | Git for Windows'ni o'rnating |

---

## 11. Halol holat: nima tayyor, nima hali yo'q

**Tayyor va testlangan** (120+ avtomatik test, brauzerda tekshirilgan): yuqoridagi barcha bo'limlar, 4 til, kirish imkoniyati (WCAG 2.1 AA), xavfsizlik, shifrlangan zaxira, mahalliy tarmoqda HTTPS va ilova sifatida o'rnatish.

**Hali yo'q — tashqi shartnoma yoki rasmiy hujjat kerak:**
- DMED / Raqamli sog'liqni saqlash platformasiga ma'lumot yuborish (rasmiy spetsifikatsiya va kirish kerak);
- Payme / Click / Uzum orqali onlayn to'lov (merchant shartnomasi); hozir to'lov turi qo'lda belgilanadi;
- Haqiqiy SMS (provayder shartnomasi); hozir SMS o'chiq;
- Fiskal chek (OFD); hozirgi chek fiskal emas;
- Rasmiy MKB-10 katalogi (litsenziyalangan ro'yxat); hozir kod formati tekshiriladi.

**Hali qilinmagan funksiyalar:** dublikat bemor kartalarini birlashtirish, qabulni ko'chirish oynasi, chop etiladigan tibbiy hujjatlar, onlayn qabulga yozilish (portal), stomatologik davolash rejasi, bir nechta klinikada ishlaydigan hisoblar uchun qo'llab-quvvatlash ekrani.

**Mutaxassis ko'rigi kerak:** tarjimalar (ona tilida so'zlashuvchi tibbiy muharrir), klinik jarayonlar (shifokor-maslahatchi), shaxsiy ma'lumotlar qonuni (huquqshunos: ma'lumotlarni O'zbekistonda saqlash, ro'yxatdan o'tkazish).

**Muhim:** haqiqiy bemorlar bilan ishlashdan oldin:
1. `npm run setup` bilan yaratilgan yangi kalitlardan foydalaning (sinov ma'lumotlari bo'lgan bazani ishlatmang);
2. har kuni zaxira nusxa oling;
3. server kompyuterni parol bilan himoyalang va disk shifrlashni (BitLocker) yoqing;
4. huquqshunos bilan maslahatlashing.

Internetdan (klinikadan tashqarida) ishlash uchun haqiqiy server, domen va TLS kerak; bu `docs/DEPLOYMENT.md` da yozilgan.
