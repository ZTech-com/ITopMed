# ITop Med — oddiy qo'llanma (0 dan 100 gacha)

## A. Har kuni ishga tushirish
1. Ish stolida **"ITop Med"** ni ikki marta bosing → klinika ilovasi ochiladi.
2. Birinchi marta Windows ruxsat so'raydi → **Ha** (telefonlar ulana olishi uchun).
3. Ishni tugatganda: **"ITop Med - to'xtatish"** (shart emas, yoniq tursa ham bo'ladi).

## B. Siz — SuperAdmin: klinika ochish (2 daqiqa)
1. **"ITop Med Boshqaruv"** yorlig'i → login + parolingiz bilan kiring.
2. **Klinikalar → Yangi klinika**:
   - Klinika turi: Xususiy kabinet / Stomatologiya / Diagnostika / Ko'p tarmoqli.
   - Asosiy yo'nalish: masalan **Kardiologiya**.
   - Egasi shifokor bo'lsa — belgini qoldiring.
   - Egasining ismi, **logini** va **parol** (tayyor parol beriladi — yozib oling).
3. **Klinikani yaratish** → "Klinika tayyor".
4. Egaga 3 narsani bering: **manzil** (`/login`), **login**, **parol**.

Franshiza (bir egada ko'p klinika): **Tarmoqlar → Yangi tarmoq** → klinikalarni qo'shing → **Tarmoq admini tayinlash**. U faqat o'z klinikalarini boshqaradi.

## C. Klinika egasi (Admin) — birinchi kun
1. **"ITop Med"** → login + parol bilan kiring.
2. Telefonga **Google Authenticator** o'rnating → ekrandagi QR'ni skanerlang → 6 xonali kodni yozing → **tiklash kodlarini** saqlang.
3. Klinika o'zi sozlanadi (xizmatlar, shablonlar, jadval).
4. **Xizmatlar va narxlar** → har xizmatga narx qo'ying (narxsiz hisob chiqmaydi).
5. **Xodimlar → Taklif qilish** → shifokor, hamshira, kassir, registrator.
6. **Sozlamalar → Nazorat qoidalari** → chegirma chegarasi (masalan 10%).

## D. Kundalik ish (masalan, kardiologiya markazi)

### Bir marta: narxlar va blank
- **Xizmatlar va narxlar** → yuqoridagi katta maydonga ro'yxatni yozing (har qatorda bittadan) → **Saqlash**:
  ```
  Kardiolog ko'ruvi — 100 000
  Umumiy ayollar — 100 000
  EXO — 120 000
  EKG — 30 000
  ```
  Narx o'zgarsa — shu ro'yxatni yangi narx bilan qayta yozing, eski xizmatning narxi yangilanadi.
- **Sozlamalar → Hujjat blanki**: logotip va litsenziya qatori — chop etiladigan hamma qog'ozning tepasida chiqadi.

### Registrator — **Qabulxona** (bitta ekran)
1. **Bemor**: qidiring (ism, telefon, tug'ilgan yil) yoki yangisini yozing — tug'ilgan **yilning o'zi** (1947) yetadi.
2. **Xizmatlar**: kerakli xizmatlarni belgilang — jami summa o'zi hisoblanadi.
3. **To'lov**: *To'liq* / *Qisman* (summani yozing) / *Qarzga*; naqd, karta, Payme, Click…
4. **O'lchovlar** (ixtiyoriy): bo'y, vazn, qon bosimi, puls.
5. **Shifokor** → **Navbatga qo'shish** → katta **navbat raqami** chiqadi → **Navbat taloni** va **Chek** (80 mm / 58 mm yoki A4).
O'ng tomonda bugungi navbat: kim, qaysi shifokorga, qancha to'lagan, qancha qarzi bor.

### Shifokor — **Bugungi bemorlarim**
- Bemor kirmasdan oldin ko'rinadi: yoshi, manzili, xizmatlari, **bosim/puls/vazn/bo'y**, to'lagan va qarzi.
- **Qabulni boshlash** → yozing → **tashxis** (kod shart emas; turi: *Asosiy* / *Hamroh* / *Asorat*) → **retsept** → **Imzolash**.
- **Xizmatlar va to'lov** kartasi: kerak bo'lsa **EXO, EKG** qo'shing → to'ladi yoki **qarzga**.
- **Hujjatlar → Kardiolog ko'ruvi** → chop etish (blank, tashxis, asorati, bosim, tavsiyalar; **narx chiqmaydi**).

Shifokor registratura va kassa ishlarini ham qilishi uchun: **Xodimlar** → shifokorga *Registrator* va *Kassir* rollarini ham bering. O'lchov yozishi uchun registratorga *Hamshira* rolini qo'shing.

### Ega
- **Bosh sahifa**: bugungi va 7 kunlik tushum, bemorlar qarzi, 14 kunlik grafik.
- **Nazorat markazi**: kassa, chegirmalar, kim nima qildi.

**Printerlar:** oddiy (A4) va chek printeri (80/58 mm) Windows'ga odatdagidek ulanadi; chop etish oynasida kerakli printerni tanlaysiz. Chek **fiskal emas** (OFD/fiskal kassa ulanmagan).

## E. Telefon va planshetni ulash (har biriga 2 daqiqa)
1. Telefon klinika Wi-Fi'siga ulangan bo'lsin.
2. Kompyuterda kirish sahifasidagi **"Telefon yoki planshetni ulash"** → QR kod.
3. Telefon kamerasi bilan skanerlang → 4 qadam: **sertifikatni yuklash → ishonch berish → ITop Med'ni ochish → ilova qilib o'rnatish**.

## F. Bemor uchun (ixtiyoriy)
- **Bemor portali**: bemor o'zi qabulga yoziladi, natija va hisoblarini ko'radi.
- **Telegram**: Integratsiyalar → @BotFather'dan olingan tokenni joylang → bemorlarga eslatma boradi.

## F2. Lokal yoki server — va har bir bemor Excel faylda
**Sozlamalar → «Ma'lumotlar qayerda saqlanadi»**
- **Lokal** (faqat Windows ilovasida): hamma narsa shu kompyuterda. Internetga hech narsa ketmaydi, bemorlarga SMS, Telegram va e-pochta xabarlari o'chadi. Ilova o'rnatilganda shu rejim avtomatik yoqiladi.
- **Server / internet bilan**: Windows ilovasida ma'lumotlar baribir kompyuterda qoladi, faqat bemorlarga xabarlar internet orqali ketadi. Saytda (itopmed.itoppos.uz) har doim shu rejim ishlaydi, chunki ma'lumotlar serverda turadi.
- **Har bir bemor alohida Excel faylda** (faqat Windows ilovasida): yoqing → papkani tanlang (odatda `Hujjatlar\ITopMed\<klinika>`). Har bir bemor uchun `P-000001 - Familiya Ism.xlsx` fayli paydo bo'ladi: karta, qabullar, tashxislar, retseptlar, bosim va boshqa ko'rsatkichlar, tahlillar, to'lovlar va qarz. Yana `Bemorlar roʻyxati.xlsx` ham bo'ladi. Biror narsa o'zgarsa, fayl 2 daqiqa ichida o'zi yangilanadi. Ochiq turgan fayl Excel yopilgandan keyin yangilanadi.
  - Buni **Bosh shifokor** roli bor xodim yoqadi, chunki fayllarda tibbiy yozuvlar bor. Fayllar shifrlanmagan, shuning uchun kompyuterga parol qo'ying.
- **Bitta bemor**: Tibbiy karta → **Excel** tugmasi. **Hammasi birdan**: Sozlamalar → «Barcha bemorlarni Excel'da yuklab olish (ZIP)». Bu sayt va ilovaning ikkalasida ishlaydi.

## G. Xavfsizlik — unutmang
- Har kuni zaxira: terminalda `npm run backup`, faylni fleshkaga ham ko'chiring.
- `.env` faylini hech kimga bermang, nusxasini xavfsiz saqlang.
- Muammo bo'lsa: terminalda `npm run app:doctor` — nima noto'g'riligini aytadi.

---

# Sotish

## Kimga
Kichik kabinet (kardiolog, pediatr...), stomatologiya, diagnostika markazi, katta klinika, franshiza.

## Nima deb sotish (asosiy 3 gap)
1. **"Pulingiz qayerda ekanini bir ekranda ko'rasiz"** — Nazorat markazi, kassa kamomadi, kim chegirma bergani.
2. **"Retsept va xulosa bir bosishda"** — shifokor vaqti tejaladi.
3. **"Bemor o'zi yoziladi, Telegram'da eslatma oladi"** — registratura yuki kamayadi.

## 15 daqiqalik ko'rsatish
Bemor yozish (2) → shifokor qabuli va retsept (5) → kassa va chegirma cheklovi (3) → Nazorat markazi (3) → telefonda bemor portali (2).

## Va'da QILMANG (hali yo'q)
DMED, Payme/Click onlayn to'lov, fiskal chek (OFD), SMS, milliy elektron retsept. Narxni o'zingiz alohida kelishasiz.

---

# Mijozga berish va o'rnatish (hech qanday dastur yoki buyruqsiz)

## Siz (bir marta, yangi versiya chiqqanda)
1. Kompyuteringizda: `npm run package:win` → tayyor fayl: **`dist\ITopMed-Windows.zip`** (~145 MB).
2. Shu zip faylni mijozga **Telegram** orqali yuboring (fayl sifatida).

## Mijoz (Windows 10 yoki 11, 64-bit noutbuk/kompyuter)
1. Telegram'dan zip'ni yuklab oladi → ustiga o'ng tugma → **"Извлечь все / Extract All"** (masalan `C:\ITopMed` ga).
2. Papkadagi **"ITop Med.exe"** ni ikki marta bosadi.
   - Windows "**Windows protected your PC**" desa: **More info → Run anyway** (dastur imzolanmagani uchun bir marta chiqadi).
3. 1–2 daqiqa kutadi → ITop Med oynasi ochiladi va **bitta forma** chiqadi:
   klinika nomi, turi (kabinet / stomatologiya / diagnostika / katta klinika), yo'nalish, ism, login, parol → **"Klinikani yaratish"**.
4. Windows tarmoq ruxsatini so'rasa → **Ha** (telefonlar ulana olishi uchun).
5. Login va parol bilan kiradi — klinika sohasiga moslab tayyor. Xizmatlarga narx qo'yadi va ishlaydi.

Ish stolida o'zi paydo bo'ladi: **ITop Med**, **ITop Med Boshqaruv**, **ITop Med - to'xtatish**.
Ma'lumotlar `%LOCALAPPDATA%\ITopMed` da saqlanadi, **har kuni o'zi shifrlangan zaxira** oladi (`backups` papkasi) — vaqti-vaqti bilan fleshkaga ko'chirib qo'ying.

## Telefon va planshetlar (mijozning xodimlari, bemorlar)
Telefonga alohida yuklab olish kerak emas va mumkin ham emas — ma'lumotlar klinika kompyuterida turadi:
1. Telefon klinika Wi-Fi'siga ulanadi.
2. Kompyuterdagi kirish sahifasida **"Telefon yoki planshetni ulash"** → QR kod → telefon kamerasi bilan skanerlanadi.
3. Ekrandagi 4 qadam → ITop Med telefonda **ilova bo'lib** (belgisi bilan) o'rnatiladi.

## Yangilash
Yangi zip'ni yuboring → mijoz yangi papkaga ochadi → "ITop Med.exe" ni bosadi. Ma'lumotlar o'z joyida qoladi, baza o'zi yangilanadi. Eski papkani keyin o'chirsa bo'ladi.

## Halol cheklovlar
- **Kompyuter:** Windows 10/11, 64-bit. Windows 7/8, 32-bit, Mac — ishlamaydi.
- **Telefon:** Android 8+ (Chrome), iPhone iOS 16.4+ (Safari) — eskiroq telefonlarda brauzer orqali ochiladi, lekin ilova sifatida o'rnamasligi mumkin.
- Telefonlar faqat **klinika Wi-Fi'sida** ishlaydi (kompyuter yoniq bo'lishi kerak). Uydan/boshqa shahardan ishlash uchun internet server va domen kerak — bu keyingi bosqich.
- Windows ogohlantirishi ("Run anyway") **kod imzolash sertifikati** sotib olinsa yo'qoladi (yiliga ~200–400 $).
- Sizning kompyuteringizda shu zip'ni ishga tushirmang: u yorliqlaringizni o'ziga moslab, alohida bo'sh baza bilan ochadi. O'zingiz uchun eski "ITop Med" yorlig'idan foydalaning.
