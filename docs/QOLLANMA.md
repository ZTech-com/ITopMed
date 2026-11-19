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
| **Xavfsizlik** | Login va parol, ixtiyoriy Telegram orqali kirish, urinishlar chegarasi |

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
Ish stolida uchta yorliq paydo bo'ladi:
- **ITop Med**: ikki marta bosing. Server orqa fonda o'zi ishga tushadi (baza, tezkor versiya, bildirishnomalar) va ITop Med alohida oynada, oddiy dastur kabi ochiladi. Birinchi marta va kod yangilangandan keyin 1–3 daqiqa, keyingi safar ~10–15 soniya. Server allaqachon ishlayotgan bo'lsa, oyna darhol ochiladi.
- **ITop Med Boshqaruv**: SuperAdmin va tarmoq adminlari uchun alohida boshqaruv dasturi (klinikalar, tarmoqlar, adminlar) — o'z oynasida ochiladi. Brauzer menyusidagi "Ilovani o'rnatish" bilan uni alohida ilova qilib ham o'rnatish mumkin.
- **ITop Med - to'xtatish**: serverni to'g'ri (bazani buzmasdan) to'liq o'chiradi.

Bu kompyuterda sertifikat kerak emas: oyna `http://127.0.0.1:3000` manzilini ochadi. Oynaning menyusidagi **"Ilovani o'rnatish"** orqali ITop Med'ni Start menyusiga ham qo'shishingiz mumkin.

**Server o'zini o'zi tiklaydi.** Ma'lumotlar bazasi, ilova yoki bildirishnomalar xizmati to'xtab qolsa (xato, elektr uzilishi, jarayon o'chirilgani), server ularni bir necha soniyada qayta ishga tushiradi; ilova javob bermay qolsa ham. Oraliqda foydalanuvchilar xato emas, "ITop Med ishga tushmoqda…" sahifasini ko'radi. Terminal oynasini yopish serverni to'xtatmaydi.

| Buyruq | Nima qiladi |
|---|---|
| `npm run app` | Serverni ishga tushiradi (kerak bo'lsa) va oynani ochadi |
| `npm run app:stop` | Hammasini to'g'ri to'xtatadi |
| `npm run app:status` | Ishlayaptimi va boshqa qurilmalar uchun manzillar |
| `npm run app:doctor` | Hammasini tekshiradi, nima qilish kerakligini aytadi va telefon uchun **manzil**ni ko'rsatadi |
| `npm run app:firewall` | Windows Firewall'da tarmoq ruxsati (bir marta, administrator ruxsati so'raladi) |
| `npm run app:autostart` | Kompyuterga kirganda server o'zi (oynasiz) ishga tushadi; o'chirish: `npm run app:autostart -- off` |

Server jurnali: `.data/logs/local.log` (5 MB dan oshsa avtomatik almashtiriladi).

## 4a. Telefon, planshet va boshqa kompyuterlar (butun klinika tarmog'i)

Bu kompyuter **server**: u yoniq va Wi-Fi/tarmoqqa ulangan bo'lishi kerak; telefonlar o'sha tarmoqda bo'lsin.

**Bir marta (server kompyuterda):** "ITop Med" yorlig'ini birinchi ochganingizda Windows o'zi ruxsat so'raydi — **Ha** ni bosing. O'tkazib yuborgan bo'lsangiz:
```bash
npm run app:firewall
```
Windows "Ha/Yo'q" deb so'raydi — **Ha**. Bu faqat shu tarmoqdagi qurilmalarga ruxsat beradi (internetga ochilmaydi) va Windows avval qo'ygan Node.js bloklarini olib tashlaydi. Tekshirish: `npm run app:doctor` — hamma qatorda ✓ bo'lishi kerak.

**Har bir telefon/planshet uchun (2 daqiqa):**
1. Server kompyuterda ITop Med kirish sahifasidagi **"Telefon yoki planshetni ulash"** havolasini bosing (yoki `npm run app:doctor`) — ulanish manzili chiqadi.
2. Telefon brauzerida shu manzilni yoki server IP manzilini yozing, masalan `192.168.0.80` — o'zi ulanish sahifasiga o'tadi.
3. Ulanish sahifasi telefon turini o'zi aniqlaydi va qadamlarni ko'rsatadi: **sertifikatni yuklab olish** → **ishonch bildirish** → **ITop Med'ni ochish** → **ilova sifatida o'rnatish**.

Sertifikat faqat shu klinika serveri uchun (`.data/certs/itopmed-local-ca.crt` — ochiq qism). Maxfiy kalit (`.key`) kompyuterdan hech qachon chiqmaydi, uni hech kimga bermang. Sahifadagi barmoq izini (SHA-256) server kompyuterdagi ulanish sahifasidagisi bilan solishtirsangiz, soxta sertifikat emasligiga ishonch hosil qilasiz.

Qo'lda o'rnatish (agar kerak bo'lsa):
- **Android:** *Sozlamalar → Xavfsizlik → Shifrlash va hisob ma'lumotlari → Sertifikat o'rnatish → CA sertifikati* → faylni tanlang.
- **iPhone/iPad:** profilni o'rnating, keyin **majburiy:** *Sozlamalar → Asosiy → Ma'lumot → Sertifikatlarga ishonch sozlamalari* → "ITop Med Local CA" ni yoqing.
- **Windows:** faylni oching → *Install Certificate* → *Current User* → **Trusted Root Certification Authorities** → *Finish*. **macOS:** Keychain → *Always Trust*.

Ilova alohida oynada, belgisi bilan ochiladi. Server bilan aloqa bo'lmasa, oflayn sahifani ko'rsatadi.

### 4.3. Email
SMTP sozlanmagan bo'lsa, xatlar (taklif havolalari, parol tiklash) server kompyuterdagi **`.dev-mailbox`** papkasiga fayl bo'lib tushadi. Faylni brauzerda ochib, havolani kerakli odamga yuborasiz.
Haqiqiy email uchun `.env` ga `SMTP_URL=smtps://login:parol@smtp.server.uz:465` qo'shing va `npm run app:stop`, `npm run app` qiling.

### 4.4. IP manzil o'zgarsa yoki Wi-Fi uzilsa
Server buni o'zi sezadi (10–20 soniyada) va yangi IP uchun sertifikatni ishlayotgan holda yangilaydi. Sertifikat markazi o'zgarmaydi, shuning uchun qurilmalarga qayta o'rnatish shart emas — faqat yangi manzilni oching (ulanish sahifasi yangisini ko'rsatadi). Manzil o'zgarmasligi uchun routerda server kompyuterga **doimiy IP** (DHCP reservation) bering.

### 4.5. Terminalda ko'rib ishga tushirish
`npm run local` — xuddi shu server, lekin chiqishi ekranda (Ctrl+C bilan to'xtaydi). Kodni yangilagach majburan qayta yig'ish: `npm run local -- --build`.

> **Ishlab chiqish rejimi** (dasturchilar uchun, faqat shu kompyuterda): `npm run db:start` va `npm run dev` → http://localhost:3000.

---

## 5. Birinchi kun: platformadan klinikagacha

### 5.0. Uch daraja — kim nimani boshqaradi

| Daraja | Kim | Qayerga kiradi | Nimani boshqaradi |
|---|---|---|---|
| **SuperAdmin** | Siz | **ITop Med Boshqaruv** (`/admin`) | Hammasi: klinikalar, tarmoqlar, tariflar, tarmoq adminlari, platforma xodimlari, audit |
| **Tarmoq admini** | Franshiza / klinikalar tarmog'i egasi | **ITop Med Boshqaruv** (`/admin`) — faqat o'z tarmog'i | O'z tarmog'ida klinika yaratish, to'xtatish, bo'limlarni yoqish, egalarga taklif. Tariflar, boshqa tarmoqlar va platforma xodimlari ko'rinmaydi |
| **Klinika Admini** (klinika egasi) | 1 ta klinikasi bor odam yoki har bir klinikaning egasi | **ITop Med** (`/login`) | O'z klinikasi: xodimlar, rollar, xizmatlar, pul, Nazorat markazi |

Hech qaysi boshqaruv darajasi (SuperAdmin ham) bemorlarning tibbiy ma'lumotlarini ko'rmaydi — bu klinika ichida qoladi. Har bir sahifaning chap yuqorisida kim ekaningiz yozilgan: "SuperAdmin · bosh boshqaruv", "Tarmoq: …" yoki klinika nomi va "Klinika egasi (Admin)".

### 5.1. Siz (SuperAdmin): klinika yaratish — bir bosishda tayyor
1. Ish stolidagi **ITop Med Boshqaruv** yorlig'ini oching (yoki `/admin/login`) va email + parol bilan kiring.
2. **Klinikalar → Yangi klinika:**
   - **Klinika turi:** Xususiy kabinet, Stomatologiya, Diagnostika, Ko'p tarmoqli klinika yoki Boshqa. Bo'limlar shu turga qarab yoqiladi (masalan, stomatologiyaga tish formulasi, kichik kabinet esa sodda qoladi).
   - **Asosiy yo'nalish:** masalan Kardiologiya — EKG, exokardiografiya, Xolter va boshqa xizmatlar o'zi qo'shiladi.
   - **Egasi o'zi ham shifokor** va/yoki **registratura va kassani ham o'zi qiladi** — kichik kabinet uchun belgilang.
   - **Klinika egasi:** ism, email va **kirish usuli**: "Parolni hozir o'zim belgilayman" (kuchli parol tayyorlab qo'yiladi — yozib oling yoki o'zingiznikini kiriting) yoki "Emailga taklif yuborish".
   - **Tarmoq** (bo'lsa) — klinika franshizaga tegishli bo'lsa.
3. "Klinikani yaratish" → **"Klinika tayyor"** va kirish manzili chiqadi. Email va parolni egaga o'zingiz bering. Parol keyin hech qayerda ko'rsatilmaydi va saqlanmaydi (faqat shifrlangan xesh).
4. Ega birinchi marta kirganda klinika sohasiga moslab **o'zi to'liq sozlanadi**: xizmatlar, hujjat va yozuv shablonlari, egaga shifokor roli va Du–Ju 9:00–18:00 jadval. Egaga faqat xizmatlarga narx qo'yish qoladi.
5. Agar bu email bilan hisob avvaldan bo'lsa, uning paroli o'zgartirilmaydi: egasi o'z paroli bilan kirib taklifni qabul qiladi.

### 5.1a. Tarmoqlar (franshiza) va tarmoq adminlari
1. **Tarmoqlar → Yangi tarmoq:** nom, mas'ul shaxs, telefon.
2. Tarmoq sahifasida: **mavjud klinikani qo'shish** yoki **"Tarmoqda yangi klinika"**.
3. **Tarmoq admini tayinlash:** ism, email, parol (yoki emailga taklif). U `/admin` ga kiradi va faqat o'z tarmog'ini ko'radi: yangi klinika yaratadi (avtomatik o'z tarmog'ida), to'xtatadi, bo'limlarni yoqadi, egalarga taklifni qayta yuboradi.
4. Klinikani tarmoqdan chiqarsangiz, tarmoq admini uni darhol ko'rmay qoladi.

**Platforma xodimlari → Xodimni taklif qilish:** o'z jamoangiz (Qo'llab-quvvatlash, Hisob-kitob, Faqat ko'rish va h.k.). Tarmoq adminlari tarmoq sahifasidan tayinlanadi.

### 5.2. Klinika egasi (misol: kichik kardiologiya kabineti)
1. SuperAdmin bergan login va parol bilan `/login` orqali kiring (yoki taklif havolasini ochib, login va parolni o'zingiz tanlang).
2. Klinika SuperAdmin tanlagan turga moslab o'zi sozlanadi. Klinikani o'zingiz yaratgan bo'lsangiz yoki boshqacha sozlamoqchi bo'lsangiz — **Sozlash yordamchisi** (bosh sahifa yoki Sozlamalar):
   - Amaliyot turi: **Xususiy kabinet**;
   - **Asosiy yo'nalish: Kardiologiya** — kardiolog konsultatsiyasi, EKG, exokardiografiya, Xolter, 24 soatlik qon bosimi monitoringi va yuklamali sinov xizmatlari qo'shiladi;
   - "Men shu yerda shifokorman" → Kardiologiya, Du–Ju 9:00–18:00 jadval;
   - Administrator bo'lmasa: "Registratura va kassani o'zim qilaman".
3. **Xizmatlar va narxlar:** har bir xizmatga narx qo'ying (narxsiz xizmatga hisob chiqarib bo'lmaydi).
4. Kerak bo'lsa **Xodimlar → Taklif qilish:** hamshira, administrator va h.k.
5. Tayyor: bemorni ro'yxatga olish → qabulga yozish → kelganini belgilash → ko'rik → hisob → to'lov.

Boshqa yo'nalishlar uchun ham tayyor xizmatlar to'plami bor: pediatriya, ginekologiya, oftalmologiya, LOR, nevrologiya, dermatologiya, urologiya, endokrinologiya, fizioterapiya, stomatologiya va diagnostika.

---

### 5.3. Kirish: login va parol yoki Telegram
Har bir xodim **login va parol** bilan kiradi (masalan, `dr.karimov`). Login hisob yaratilganda tanlanadi. 2026-11-19 gacha yaratilgan hisoblarda login — emailning o'zi. Ikki bosqichli tekshiruv (Google Authenticator) yo'q.

**Telegram orqali kirish** (ixtiyoriy, faqat internetdagi serverda):
1. `.env` ga `TELEGRAM_LOGIN_CLIENT_ID` va `TELEGRAM_LOGIN_CLIENT_SECRET` yoziladi (@BotFather → bot → Login Widget; Allowed URL: `https://<domen>/auth/telegram/callback`).
2. Xodim avval login va parol bilan kiradi, **Hisob xavfsizligi** sahifasida **«Telegramni ulash»** ni bosadi.
3. Keyin kirish sahifasidagi **«Telegram orqali kirish»** tugmasi bilan parolsiz kiradi.

Klinika ichidagi mahalliy o'rnatishda (`192.168.x.x`) Telegram ishlamaydi — Telegram faqat internetdagi domenni qabul qiladi. U yerda faqat login va parol.

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
| O'z jamoangiz | `/admin/staff`: taklif qilish |
| Kim nima qildi | `/admin/audit` → "Zanjirni tekshirish" (jurnal o'zgartirilmaganini isbotlaydi) |
| O'z xavfsizligingiz | Pastki chapdagi qalqon belgisi → tiklash kodlari |

**Klinika egasi o'z klinikasida:** Xodimlar (rol, filial, to'xtatish, yangi parol berish), Rollar va huquqlar, Filiallar, Bo'limlar va xonalar, Shifokorlar va jadval, Xizmatlar va narxlar, Sozlamalar (bo'limlar), Faoliyat jurnali, Qo'llab-quvvatlash kirishi (ITop Med so'rovlarini tasdiqlash yoki rad etish).

---

## 7a. Nazorat markazi va nazorat qoidalari (egasi uchun)

**Nazorat markazi** (chap menyuda, qalqon belgisi) bitta sahifada ko'rsatadi:
- **Bugun:** qabullar soni, kutayotganlar, kelmaganlar, bugungi va oylik tushum (o'tgan oyning shu kunlariga nisbatan %), bemorlarning qarzi;
- **Kassalar:** ochiq smenalar va hozir har bir kassada bo'lishi kerak bo'lgan naqd pul; smena yopilishidagi kamomad va ortiqchalar;
- **Chegirmalar:** kim, necha marta va qancha chegirma bergan (30 kun); pul qaytarishlar va bekor qilingan hisoblar;
- **Klinik intizom:** 24 soatdan ortiq imzolanmagan yozuvlar (shifokor bo'yicha), ochiq qolgan qabullar, hisob chiqarilmagan qabullar;
- **Xavfsizlik:** tibbiy kartaga favqulodda kirishlar, yordam xizmatiga berilgan ruxsatlar.

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
| "Your connection is not private" / sertifikat xatosi | Shu qurilmaga sertifikat o'rnatilmagan: telefonda server IP manzilini yozing (masalan `192.168.0.80`) va ulanish sahifasidagi qadamlarni bajaring (4a) |
| Telefonda sahifa ochilmaydi | `npm run app:doctor` ni ishga tushiring — u sababini aytadi. Odatda: telefon boshqa Wi-Fi'da; server o'chiq; Firewall ruxsati yo'q (`npm run app:firewall`); mehmon Wi-Fi qurilmalarni bir-biridan ajratadi (asosiy Wi-Fi'ga ulaning) |
| ITop Med oynasi ochilmaydi yoki "ishga tushmadi" | `npm run app:doctor`; xato matni va jurnal: `.data/logs/local.log`. `npm run app:stop`, keyin `npm run app` |
| "Too many attempts" | 5–15 daqiqa kuting (xavfsizlik chegarasi) |
| Hisob bloklangan | 5 marta noto'g'ri parol: 15 daqiqa kuting yoki "Parolni unutdingizmi" (klinika xodimlari). Platforma xodimlari parolini Super administrator yoki `admin:create` buyrug'i bilan tiklaydi |
| Parol esdan chiqqan | Klinika egasi yoki administrator xodim sahifasida yangi parol beradi (Telegram bog'lanishi ham uziladi) |
| Taklif xati kelmadi | SMTP yo'q: `.dev-mailbox` papkasini oching (4.3) |
| Xizmatga hisob chiqmaydi | Xizmatga narx qo'yilmagan |
| Shifokorga qabul yozib bo'lmaydi | Jadval yo'q, ta'tilda yoki vaqt band |
| `npm run local` "OpenSSL was not found" | Git for Windows'ni o'rnating |

---

## 11. Halol holat: nima tayyor, nima hali yo'q

**Tayyor va testlangan** (139 avtomatik test, 66 ekran telefon/planshet/kompyuterda tekshirilgan, 15 bosqichli to'liq klinik yo'l brauzerda sinovdan o'tgan): yuqoridagi barcha bo'limlar, 4 til, kirish imkoniyati (WCAG 2.1 AA), xavfsizlik, shifrlangan zaxira, mahalliy tarmoqda HTTPS va ilova sifatida o'rnatish.

**Hali yo'q — tashqi shartnoma yoki rasmiy hujjat kerak:**
- DMED / Raqamli sog'liqni saqlash platformasiga ma'lumot yuborish (rasmiy spetsifikatsiya va kirish kerak);
- Payme / Click / Uzum orqali onlayn to'lov (merchant shartnomasi); hozir to'lov turi qo'lda belgilanadi;
- Haqiqiy SMS (provayder shartnomasi); hozir SMS o'chiq;
- Fiskal chek (OFD); hozirgi chek fiskal emas;
- Rasmiy MKB-10 katalogi (litsenziyalangan ro'yxat); hozir kod formati tekshiriladi.

**Hali qilinmagan funksiyalar:** dublikat bemor kartalarini birlashtirish, stomatologik davolash rejasi, bir nechta klinikada ishlaydigan hisoblar uchun qo'llab-quvvatlash ekrani, rasmiy kasallik varaqasi shakli.

**Mutaxassis ko'rigi kerak:** tarjimalar (ona tilida so'zlashuvchi tibbiy muharrir), klinik jarayonlar (shifokor-maslahatchi), shaxsiy ma'lumotlar qonuni (huquqshunos: ma'lumotlarni O'zbekistonda saqlash, ro'yxatdan o'tkazish).

**Muhim:** haqiqiy bemorlar bilan ishlashdan oldin:
1. `npm run setup` bilan yaratilgan yangi kalitlardan foydalaning (sinov ma'lumotlari bo'lgan bazani ishlatmang);
2. har kuni zaxira nusxa oling;
3. server kompyuterni parol bilan himoyalang va disk shifrlashni (BitLocker) yoqing;
4. huquqshunos bilan maslahatlashing.

Internetdan (klinikadan tashqarida) ishlash uchun haqiqiy server, domen va TLS kerak; bu `docs/DEPLOYMENT.md` da yozilgan.
